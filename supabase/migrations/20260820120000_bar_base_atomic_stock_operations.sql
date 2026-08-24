-- Bar POS Base stock operations.
--
-- These are deliberately separate from purchasing, supplier, lot/expiry, and
-- accounting workflows.  A count or a simple delivery is one atomic RPC,
-- carrying one stable operation id and one payload hash for safe offline
-- replay.  The server locks every affected inventory row in item-id order,
-- validates the complete expected envelope before writing anything, and
-- records immutable evidence in the movement ledger.

begin;

create table if not exists public.bar_stock_operation_idempotency (
  operation_id uuid primary key,
  lodge_id uuid not null,
  outlet_id uuid,
  operation_type text not null,
  payload_hash text not null,
  result jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint bar_stock_operation_type_chk
    check (operation_type in ('physical_count', 'simple_delivery')),
  constraint bar_stock_operation_payload_hash_chk
    check (length(payload_hash) = 64)
);

create index if not exists bar_stock_operation_lodge_created_idx
  on public.bar_stock_operation_idempotency (lodge_id, created_at desc);

alter table public.bar_stock_operation_idempotency enable row level security;
revoke all on table public.bar_stock_operation_idempotency from public, anon, authenticated;
grant select, insert, update on table public.bar_stock_operation_idempotency to service_role;

alter table public.inventory_movements
  add column if not exists expected_qty numeric,
  add column if not exists actual_qty numeric,
  add column if not exists reason_code text;

-- The operation id is unique at the operation table, not on movement rows:
-- one count/delivery intentionally creates one immutable movement per line.
create index if not exists inventory_movements_bar_base_history_idx
  on public.inventory_movements (lodge_id, reference_type, created_at desc)
  where reference_type in ('bar_physical_count', 'bar_simple_delivery');

create or replace function public._bar_stock_require_manage(
  p_lodge_id uuid,
  p_outlet_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.app_current_user_id();
begin
  -- Base stock mutations are manager-controlled.  This is the server-side
  -- counterpart to inventory.manage; the renderer capability is guidance,
  -- never the authorization boundary.
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['manager', 'admin', 'super_admin']
  );
  if p_outlet_id is not null then
    perform public.app_require_pos_outlet_access(p_lodge_id, p_outlet_id);
  end if;
  return v_actor;
end;
$$;

revoke all on function public._bar_stock_require_manage(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public._bar_stock_require_manage(uuid, uuid)
  to service_role;

create or replace function public.post_bar_physical_count(
  p_lodge_id uuid,
  p_outlet_id uuid,
  p_operation_id uuid,
  p_lines jsonb,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_hash text;
  v_existing public.bar_stock_operation_idempotency%rowtype;
  v_line jsonb;
  v_item public.inventory_items%rowtype;
  v_expected numeric;
  v_actual numeric;
  v_delta numeric;
  v_count integer := 0;
  v_locked integer := 0;
  v_results jsonb := '[]'::jsonb;
  v_result jsonb;
  v_unit_cost numeric;
  v_variance_count integer := 0;
  v_variance_total numeric := 0;
  v_journal jsonb;
  v_cogs uuid;
  v_inventory uuid;
begin
  v_actor := public._bar_stock_require_manage(p_lodge_id, p_outlet_id);
  -- Serialize all retries of one operation key before reading the idempotency
  -- row.  This avoids a same-key race reaching the unique constraint.
  if p_operation_id is null then
    return jsonb_build_object('success', false, 'error', 'A stable count operation id is required.');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('bar-stock:' || p_operation_id::text, 0));
  if jsonb_typeof(p_lines) is distinct from 'array' or coalesce(jsonb_array_length(p_lines), 0) = 0 then
    return jsonb_build_object('success', false, 'error', 'A physical count must contain at least one stock line.');
  end if;
  if jsonb_array_length(p_lines) > 500 then
    return jsonb_build_object('success', false, 'error', 'A physical count cannot contain more than 500 stock lines.');
  end if;
  if (select count(distinct value->>'item_id') from jsonb_array_elements(p_lines)) <> jsonb_array_length(p_lines) then
    return jsonb_build_object('success', false, 'error', 'A physical count must contain each stock item exactly once.');
  end if;
  if p_notes is not null and length(btrim(p_notes)) > 300 then
    return jsonb_build_object('success', false, 'error', 'Count notes must be 300 characters or fewer.');
  end if;

  v_hash := encode(digest(jsonb_build_object(
    'lodge_id', p_lodge_id,
    'outlet_id', p_outlet_id,
    'operation_id', p_operation_id,
    'lines', p_lines,
    'notes', nullif(btrim(coalesce(p_notes, '')), '')
  )::text, 'sha256'), 'hex');

  select * into v_existing
    from public.bar_stock_operation_idempotency
   where operation_id = p_operation_id
   for update;
  if found then
    if v_existing.lodge_id is distinct from p_lodge_id
       or v_existing.payload_hash is distinct from v_hash
       or v_existing.operation_type <> 'physical_count' then
      raise exception 'Count operation id was already used with a different payload.'
        using errcode = '23505';
    end if;
    return v_existing.result || jsonb_build_object('success', true, 'idempotent', true);
  end if;

  -- Validate all lines before mutating anything.  Ordering by UUID makes
  -- concurrent counts touching overlapping lines acquire locks identically.
  for v_line in
    select value
      from jsonb_array_elements(p_lines)
     order by value->>'item_id'
  loop
    v_count := v_count + 1;
    if nullif(v_line->>'item_id', '') is null
       or nullif(v_line->>'expected_qty', '') is null
       or nullif(v_line->>'actual_qty', '') is null then
      return jsonb_build_object('success', false, 'error', 'Each count line requires item_id, expected_qty, and actual_qty.');
    end if;
    if (v_line->>'item_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      return jsonb_build_object('success', false, 'error', 'Each count line requires a valid stock item id.') ;
    end if;
    begin
      v_expected := (v_line->>'expected_qty')::numeric;
      v_actual := (v_line->>'actual_qty')::numeric;
    exception when invalid_text_representation or numeric_value_out_of_range then
      return jsonb_build_object('success', false, 'error', 'Count quantities must be finite numbers.');
    end;
    if lower(v_expected::text) in ('nan', 'infinity', '-infinity')
       or lower(v_actual::text) in ('nan', 'infinity', '-infinity') then
      return jsonb_build_object('success', false, 'error', 'Count quantities must be finite numbers.');
    end if;
    if v_expected < 0 or v_actual < 0 then
      return jsonb_build_object('success', false, 'error', 'Count quantities cannot be negative.');
    end if;
    if nullif(btrim(v_line->>'expected_updated_at'), '') is null then
      return jsonb_build_object(
        'success', false,
        'error', 'Each count line requires expected_updated_at version evidence. Refresh the certified stock list and recount.',
        'code', 'missing_stock_version'
      );
    end if;
    if length(btrim(coalesce(v_line->>'reason', ''))) > 300 then
      return jsonb_build_object('success', false, 'error', 'A count reason must be 300 characters or fewer.');
    end if;

    select * into v_item
      from public.inventory_items
     where id = nullif(v_line->>'item_id', '')::uuid
       and lodge_id = p_lodge_id
       and (p_outlet_id is null or outlet_id = p_outlet_id)
     for update;
    if not found then
      return jsonb_build_object('success', false, 'error', 'A count item is outside the selected lodge or outlet.');
    end if;
    v_locked := v_locked + 1;

    -- expected_qty is the server-read evidence supplied by the operator.  A
    -- changed balance means the count is stale and the entire transaction
    -- must be retried after a fresh certified read.
    if coalesce(v_item.current_stock, 0) is distinct from v_expected then
      return jsonb_build_object(
        'success', false,
        'error', format('Count is stale for %s. Refresh the certified stock list and recount.', v_item.name),
        'code', 'stale_expected_quantity',
        'item_id', v_item.id,
        'server_expected_qty', coalesce(v_item.current_stock, 0),
        'submitted_expected_qty', v_expected
      );
    end if;
    begin
      if v_item.updated_at is distinct from (v_line->>'expected_updated_at')::timestamptz then
        return jsonb_build_object(
          'success', false,
          'error', format('Stock changed after the certified read for %s. Refresh and recount.', v_item.name),
          'code', 'stale_stock_version',
          'item_id', v_item.id
        );
      end if;
    exception when invalid_datetime_format or datetime_field_overflow then
      return jsonb_build_object('success', false, 'error', 'Count version evidence is invalid. Refresh and recount.');
    end;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'item_id', v_item.id,
      'item_name', v_item.name,
      'expected_qty', v_expected,
      'actual_qty', v_actual,
      'delta', v_actual - v_expected,
      'unit', v_item.unit,
      'outlet_id', v_item.outlet_id
    ));
  end loop;

  if v_locked <> v_count then
    return jsonb_build_object('success', false, 'error', 'The count contains duplicate or unavailable stock lines. Refresh and try again.');
  end if;

  -- Second pass applies the already-validated, already-locked envelope.
  for v_line in
    select value
      from jsonb_array_elements(p_lines)
     order by value->>'item_id'
  loop
    select * into v_item
      from public.inventory_items
     where id = (v_line->>'item_id')::uuid
       and lodge_id = p_lodge_id
     for update;
    v_expected := (v_line->>'expected_qty')::numeric;
    v_actual := (v_line->>'actual_qty')::numeric;
    v_delta := v_actual - v_expected;
    v_unit_cost := coalesce(v_item.latest_unit_cost, 0);

    update public.inventory_items
       set current_stock = v_actual,
           updated_at = now()
     where id = v_item.id and lodge_id = p_lodge_id;
    if v_item.outlet_id is not null then
      perform public.restaurant_apply_outlet_stock_balance(p_lodge_id, v_item.id, v_item.outlet_id, v_delta);
    end if;
    if v_delta <> 0 then
      v_variance_count := v_variance_count + 1;
      v_variance_total := v_variance_total + round(v_delta * v_unit_cost, 2);
    end if;
    insert into public.inventory_movements (
      lodge_id, item_id, movement_type, quantity, unit_cost, total_cost,
      notes, reference_type, reference_id, source, created_by,
      operation_id, payload_hash, source_document_type, source_document_id,
      valuation_method, quantity_before, quantity_after, cost_basis,
      recorded_at, expected_qty, actual_qty, reason_code
    ) values (
      p_lodge_id, v_item.id, 'physical_count', v_delta, v_unit_cost,
      round(v_delta * v_unit_cost, 2),
      nullif(btrim(coalesce(v_line->>'reason', p_notes, '')), ''),
      'bar_physical_count', p_operation_id, 'bar_base', v_actor,
      p_operation_id, v_hash, 'bar_physical_count', p_operation_id,
      'manual_count', v_expected, v_actual, abs(round(v_delta * v_unit_cost, 2)),
      now(), v_expected, v_actual,
      nullif(btrim(coalesce(v_line->>'reason_code', 'routine_count')), '')
    );
  end loop;

  -- Keep the latest accounting/source-posting contract intact when the
  -- Accounting add-on is active.  Base UI never exposes GL fields, but an
  -- enabled accounting ledger must receive the same balanced variance entry
  -- as the authoritative stocktake workflow.
  if public.restaurant_accounting_is_active(p_lodge_id) and v_variance_count > 0 then
    select m.account_id into v_cogs
      from public.restaurant_pos_gl_mappings m
      join public.restaurant_accounts a on a.id = m.account_id
       and a.lodge_id = p_lodge_id and a.is_active and a.account_type = 'expense'
     where m.lodge_id = p_lodge_id and m.mapping_type = 'cogs'
       and m.source_key = 'default'
       and m.effective_from <= public.get_lodge_business_date(p_lodge_id)
       and (m.effective_to is null or m.effective_to >= public.get_lodge_business_date(p_lodge_id))
     limit 1;
    select m.account_id into v_inventory
      from public.restaurant_pos_gl_mappings m
      join public.restaurant_accounts a on a.id = m.account_id
       and a.lodge_id = p_lodge_id and a.is_active and a.account_type = 'asset'
     where m.lodge_id = p_lodge_id and m.mapping_type = 'inventory'
       and m.source_key = 'default'
       and m.effective_from <= public.get_lodge_business_date(p_lodge_id)
       and (m.effective_to is null or m.effective_to >= public.get_lodge_business_date(p_lodge_id))
     limit 1;
    if v_cogs is null or v_inventory is null then
      raise exception 'Accounting is active but typed COGS and inventory mappings are missing for this count.' using errcode = '23503';
    end if;
    v_journal := public._restaurant_post_journal(
      p_lodge_id,
      public.get_lodge_business_date(p_lodge_id),
      'Bar physical count ' || p_operation_id,
      'bar_physical_count',
      p_operation_id,
      null,
      'bar-physical-count:' || p_operation_id::text,
      jsonb_build_array(
        jsonb_build_object('account_id', case when v_variance_total >= 0 then v_inventory else v_cogs end, 'debit', abs(v_variance_total), 'credit', 0, 'memo', 'Bar physical count variance'),
        jsonb_build_object('account_id', case when v_variance_total >= 0 then v_cogs else v_inventory end, 'debit', 0, 'credit', abs(v_variance_total), 'memo', 'Bar physical count variance')
      ),
      v_actor,
      null
    );
    perform public.record_restaurant_source_posting(
      p_lodge_id, 'bar_physical_count', p_operation_id,
      public.get_lodge_business_date(p_lodge_id),
      (v_journal->'data'->>'entry_id')::uuid, p_operation_id, v_hash,
      1, p_outlet_id, 'posted'
    );
  end if;

  v_result := jsonb_build_object(
    'success', true,
    'operation_id', p_operation_id,
    'operation_type', 'physical_count',
    'outlet_id', p_outlet_id,
    'line_count', v_count,
    'lines', v_results,
    'idempotent', false,
    'server_complete', true
  );
  insert into public.bar_stock_operation_idempotency (
    operation_id, lodge_id, outlet_id, operation_type, payload_hash, result, created_by
  ) values (
    p_operation_id, p_lodge_id, p_outlet_id, 'physical_count', v_hash, v_result, v_actor
  );
  return v_result;
end;
$$;

create or replace function public.post_bar_simple_delivery(
  p_lodge_id uuid,
  p_outlet_id uuid,
  p_operation_id uuid,
  p_lines jsonb,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_hash text;
  v_existing public.bar_stock_operation_idempotency%rowtype;
  v_line jsonb;
  v_item public.inventory_items%rowtype;
  v_qty numeric;
  v_before numeric;
  v_after numeric;
  v_count integer := 0;
  v_locked integer := 0;
  v_results jsonb := '[]'::jsonb;
  v_result jsonb;
begin
  v_actor := public._bar_stock_require_manage(p_lodge_id, p_outlet_id);
  if p_operation_id is null then
    return jsonb_build_object('success', false, 'error', 'A stable delivery operation id is required.');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('bar-stock:' || p_operation_id::text, 0));
  if jsonb_typeof(p_lines) is distinct from 'array' or coalesce(jsonb_array_length(p_lines), 0) = 0 then
    return jsonb_build_object('success', false, 'error', 'A delivery must contain at least one stock line.');
  end if;
  if jsonb_array_length(p_lines) > 500 then
    return jsonb_build_object('success', false, 'error', 'A delivery cannot contain more than 500 stock lines.');
  end if;
  if (select count(distinct value->>'item_id') from jsonb_array_elements(p_lines)) <> jsonb_array_length(p_lines) then
    return jsonb_build_object('success', false, 'error', 'A delivery must contain each stock item exactly once.');
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_lines) line
     where line ?| array['supplier', 'supplier_id', 'purchase_order', 'purchase_order_id', 'lot_id', 'expiry', 'expiry_date', 'unit_cost', 'valuation_method']
  ) then
    return jsonb_build_object('success', false, 'error', 'Base simple delivery does not accept supplier, purchase order, lot, expiry, cost, or valuation fields. Use Purchase Receiving for that evidence.');
  end if;
  if p_notes is not null and length(btrim(p_notes)) > 300 then
    return jsonb_build_object('success', false, 'error', 'Delivery notes must be 300 characters or fewer.');
  end if;

  v_hash := encode(digest(jsonb_build_object(
    'lodge_id', p_lodge_id,
    'outlet_id', p_outlet_id,
    'operation_id', p_operation_id,
    'lines', p_lines,
    'notes', nullif(btrim(coalesce(p_notes, '')), '')
  )::text, 'sha256'), 'hex');
  select * into v_existing
    from public.bar_stock_operation_idempotency
   where operation_id = p_operation_id
   for update;
  if found then
    if v_existing.lodge_id is distinct from p_lodge_id
       or v_existing.payload_hash is distinct from v_hash
       or v_existing.operation_type <> 'simple_delivery' then
      raise exception 'Delivery operation id was already used with a different payload.' using errcode = '23505';
    end if;
    return v_existing.result || jsonb_build_object('success', true, 'idempotent', true);
  end if;
  if public.restaurant_accounting_is_active(p_lodge_id) then
    return jsonb_build_object(
      'success', false,
      'code', 'accounting_purchase_receiving_required',
      'error', 'Accounting is active for this lodge. Use the audited Purchase Receiving workflow for deliveries.'
    );
  end if;

  for v_line in
    select value from jsonb_array_elements(p_lines) order by value->>'item_id'
  loop
    v_count := v_count + 1;
    if nullif(v_line->>'item_id', '') is null or nullif(v_line->>'quantity', '') is null then
      return jsonb_build_object('success', false, 'error', 'Each delivery line requires item_id and quantity.');
    end if;
    if (v_line->>'item_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      return jsonb_build_object('success', false, 'error', 'Each delivery line requires a valid stock item id.');
    end if;
    begin v_qty := (v_line->>'quantity')::numeric;
    exception when invalid_text_representation or numeric_value_out_of_range then
      return jsonb_build_object('success', false, 'error', 'Delivery quantities must be finite numbers.');
    end;
    if lower(v_qty::text) in ('nan', 'infinity', '-infinity') then
      return jsonb_build_object('success', false, 'error', 'Delivery quantities must be finite numbers.');
    end if;
    if v_qty <= 0 then
      return jsonb_build_object('success', false, 'error', 'Delivery quantities must be greater than zero.');
    end if;
    if length(btrim(coalesce(v_line->>'reason', ''))) > 300 then
      return jsonb_build_object('success', false, 'error', 'A delivery reason must be 300 characters or fewer.');
    end if;
    select * into v_item
      from public.inventory_items
     where id = nullif(v_line->>'item_id', '')::uuid
       and lodge_id = p_lodge_id
       and (p_outlet_id is null or outlet_id = p_outlet_id)
     for update;
    if not found then
      return jsonb_build_object('success', false, 'error', 'A delivery item is outside the selected lodge or outlet.');
    end if;
    v_locked := v_locked + 1;
    v_before := coalesce(v_item.current_stock, 0);
    v_after := v_before + v_qty;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'item_id', v_item.id, 'item_name', v_item.name,
      'quantity', v_qty, 'quantity_before', v_before,
      'quantity_after', v_after, 'unit', v_item.unit,
      'outlet_id', v_item.outlet_id
    ));
  end loop;
  if v_locked <> v_count then
    return jsonb_build_object('success', false, 'error', 'The delivery contains duplicate or unavailable stock lines. Refresh and try again.');
  end if;

  for v_line in
    select value from jsonb_array_elements(p_lines) order by value->>'item_id'
  loop
    select * into v_item from public.inventory_items
     where id = (v_line->>'item_id')::uuid and lodge_id = p_lodge_id for update;
    v_qty := (v_line->>'quantity')::numeric;
    v_before := coalesce(v_item.current_stock, 0);
    v_after := v_before + v_qty;
    update public.inventory_items set current_stock = v_after, updated_at = now()
     where id = v_item.id and lodge_id = p_lodge_id;
    if v_item.outlet_id is not null then
      perform public.restaurant_apply_outlet_stock_balance(p_lodge_id, v_item.id, v_item.outlet_id, v_qty);
    end if;
    insert into public.inventory_movements (
      lodge_id, item_id, movement_type, quantity, unit_cost, total_cost,
      notes, reference_type, reference_id, source, created_by,
      operation_id, payload_hash, source_document_type, source_document_id,
      valuation_method, quantity_before, quantity_after, cost_basis,
      recorded_at, expected_qty, actual_qty, reason_code
    ) values (
      p_lodge_id, v_item.id, 'simple_delivery', v_qty, 0, 0,
      nullif(btrim(coalesce(v_line->>'reason', p_notes, '')), ''),
      'bar_simple_delivery', p_operation_id, 'bar_base', v_actor,
      p_operation_id, v_hash, 'bar_simple_delivery', p_operation_id,
      'unknown_legacy', v_before, v_after, 0, now(), null, v_qty,
      nullif(btrim(coalesce(v_line->>'reason_code', 'delivery_received')), '')
    );
  end loop;

  v_result := jsonb_build_object(
    'success', true, 'operation_id', p_operation_id,
    'operation_type', 'simple_delivery', 'outlet_id', p_outlet_id,
    'line_count', v_count, 'lines', v_results,
    'idempotent', false, 'server_complete', true
  );
  insert into public.bar_stock_operation_idempotency (
    operation_id, lodge_id, outlet_id, operation_type, payload_hash, result, created_by
  ) values (
    p_operation_id, p_lodge_id, p_outlet_id, 'simple_delivery', v_hash, v_result, v_actor
  );
  return v_result;
end;
$$;

create or replace function public.get_bar_stock_count_history(
  p_lodge_id uuid,
  p_outlet_id uuid default null,
  p_limit integer default 200
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows jsonb;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);
  if p_outlet_id is not null then perform public.app_require_pos_outlet_access(p_lodge_id, p_outlet_id); end if;
  select coalesce(jsonb_agg(to_jsonb(row) order by row.created_at desc), '[]'::jsonb)
    into v_rows
    from (
      select m.id, m.lodge_id, m.item_id, i.name as item_name, i.unit as item_unit,
             i.outlet_id, m.reference_type, m.reference_id as operation_id,
             m.movement_type, m.quantity as delta, m.expected_qty,
             m.actual_qty, m.reason_code, m.notes, m.created_by as actor_id,
             coalesce(u.name, u.email, m.created_by::text) as actor_name,
             m.created_at, m.recorded_at, m.payload_hash
        from public.inventory_movements m
        join public.inventory_items i on i.id = m.item_id and i.lodge_id = p_lodge_id
        left join public.users u on u.id = m.created_by and u.lodge_id = p_lodge_id
       where m.lodge_id = p_lodge_id
         and m.reference_type in ('bar_physical_count', 'bar_simple_delivery')
         and (p_outlet_id is null or i.outlet_id = p_outlet_id)
       order by m.created_at desc
       limit greatest(1, least(coalesce(p_limit, 200), 500))
    ) row;
  return jsonb_build_object('success', true, 'rows', v_rows, 'complete', true, 'source', 'server');
end;
$$;

revoke all on function public.post_bar_physical_count(uuid, uuid, uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.post_bar_simple_delivery(uuid, uuid, uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.get_bar_stock_count_history(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.post_bar_physical_count(uuid, uuid, uuid, jsonb, text) to anon, authenticated, service_role;
grant execute on function public.post_bar_simple_delivery(uuid, uuid, uuid, jsonb, text) to anon, authenticated, service_role;
grant execute on function public.get_bar_stock_count_history(uuid, uuid, integer) to anon, authenticated, service_role;

commit;
