-- Preserve explicit AP bill line tax treatment and infer taxable for taxed lines.
begin;
create or replace function public.create_restaurant_bill_v3(
  p_lodge_id uuid, p_supplier_id uuid, p_supplier_name text, p_bill_number text,
  p_bill_date date, p_due_date date, p_notes text, p_items jsonb,
  p_idempotency_key text, p_currency text default 'BWP',
  p_exchange_rate numeric default 1, p_tax_code text default null,
  p_source_document_ref text default null, p_source_document_hash text default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid; v_bill_id uuid := gen_random_uuid(); v_item jsonb; v_hash text;
  v_qty numeric; v_unit numeric; v_line numeric; v_tax numeric; v_tax_rate numeric; v_treatment text;
  v_subtotal numeric := 0; v_tax_total numeric := 0; v_existing record;
  v_currency text := upper(coalesce(nullif(btrim(p_currency), ''), 'BWP'));
  v_base_currency text;
begin
  v_actor := public._restaurant_require_capability(p_lodge_id, 'accounting.manage');
  select upper(coalesce(nullif(btrim(s.currency), ''), 'BWP')) into v_base_currency
    from public.settings s where s.lodge_id = p_lodge_id;
  if nullif(btrim(p_supplier_name), '') is null
     or nullif(btrim(p_bill_number), '') is null
     or p_bill_date is null or p_due_date < p_bill_date
     or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0
     or nullif(btrim(p_idempotency_key), '') is null
     or v_currency !~ '^[A-Z]{3}$' or coalesce(p_exchange_rate, 0) <= 0 then
    raise exception 'Supplier, invoice number, valid dates, currency, exchange rate, items and idempotency key are required' using errcode = '22023';
  end if;
  if p_supplier_id is not null and not exists (
    select 1 from public.restaurant_suppliers s
     where s.id = p_supplier_id and s.lodge_id = p_lodge_id
  ) then
    raise exception 'Supplier belongs to another lodge or is missing' using errcode = '23503';
  end if;
  -- Journal and subledger amounts are currently lodge-base-currency amounts.
  -- Do not accept a foreign amount until an approved FX policy and converted
  -- base-amount columns exist; silently summing currencies would be false.
  if v_base_currency is null or v_currency <> v_base_currency or round(coalesce(p_exchange_rate, 0), 8) <> 1 then
    raise exception 'AP foreign-currency bills are unavailable until lodge FX configuration is enabled; use the lodge base currency and exchange rate 1' using errcode = '0A000';
  end if;
  v_hash := encode(digest(jsonb_build_object(
    'supplier_id', p_supplier_id, 'supplier_name', btrim(p_supplier_name),
    'bill_number', btrim(p_bill_number), 'bill_date', p_bill_date,
    'due_date', p_due_date, 'notes', nullif(btrim(p_notes), ''),
    'items', p_items, 'currency', v_currency,
    'exchange_rate', round(p_exchange_rate, 8), 'tax_code', nullif(btrim(p_tax_code), ''),
    'source_document_ref', nullif(btrim(p_source_document_ref), ''),
    'source_document_hash', nullif(btrim(p_source_document_hash), '')
  )::text, 'sha256'), 'hex');
  select id, creation_payload_hash into v_existing
    from public.restaurant_bills
   where lodge_id = p_lodge_id and creation_idempotency_key = p_idempotency_key
   for update;
  if found then
    if v_existing.creation_payload_hash is distinct from v_hash then
      raise exception 'Bill idempotency key conflicts with a different payload' using errcode = '23505';
    end if;
    return jsonb_build_object('success', true, 'data', jsonb_build_object('id', v_existing.id, 'replayed', true));
  end if;
  if exists (
    select 1 from public.restaurant_bills
     where lodge_id = p_lodge_id and lower(supplier_name) = lower(btrim(p_supplier_name))
       and lower(bill_number) = lower(btrim(p_bill_number)) and status <> 'cancelled'
  ) then
    raise exception 'Supplier invoice number already exists for this lodge' using errcode = '23505';
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_qty := round(coalesce((v_item->>'quantity')::numeric, 0), 3);
    v_unit := round(coalesce((v_item->>'unit_cost')::numeric, 0), 2);
    v_tax := round(coalesce((v_item->>'tax_amount')::numeric, 0), 2);
    v_tax_rate := nullif(v_item->>'tax_rate', '')::numeric;
    v_treatment := lower(coalesce(nullif(btrim(v_item->>'tax_treatment'), ''), case when v_tax <> 0 then 'taxable' else 'out_of_scope' end));
    if v_treatment not in ('taxable','zero_rated','exempt','out_of_scope','unknown')
       or (v_tax > 0 and v_treatment <> 'taxable') then
      raise exception 'Tax amount and tax treatment must agree; taxed bill lines must be taxable' using errcode = '22023';
    end if;
    if v_qty <= 0 or v_unit < 0 or v_tax < 0
       or nullif(btrim(v_item->>'description'), '') is null
       or (v_tax_rate is not null and (v_tax_rate < 0 or v_tax_rate > 100)) then
      raise exception 'Every bill item requires description, positive quantity, valid cost/tax and a bounded tax rate' using errcode = '22023';
    end if;
    if not exists (
      select 1 from public.restaurant_accounts
       where id = nullif(v_item->>'expense_account_id', '')::uuid
         and lodge_id = p_lodge_id and is_active and account_type in ('asset', 'expense')
    ) then
      raise exception 'Bill line account must be an active lodge asset or expense' using errcode = '23503';
    end if;
    if nullif(v_item->>'inventory_item_id', '') is not null and not exists (
      select 1 from public.inventory_items
       where id = (v_item->>'inventory_item_id')::uuid and lodge_id = p_lodge_id
    ) then
      raise exception 'Bill inventory item belongs to another lodge or is missing' using errcode = '23503';
    end if;
    v_line := round(v_qty * v_unit, 2);
    v_subtotal := v_subtotal + v_line;
    v_tax_total := v_tax_total + v_tax;
  end loop;

  insert into public.restaurant_bills (
    id, lodge_id, supplier_id, supplier_name, bill_number, bill_date, due_date,
    subtotal, tax_amount, total, amount_paid, status, notes, created_by,
    creation_idempotency_key, creation_payload_hash, currency, exchange_rate,
    tax_code, source_document_ref, source_document_hash
  ) values (
    v_bill_id, p_lodge_id, p_supplier_id, btrim(p_supplier_name), btrim(p_bill_number),
    p_bill_date, p_due_date, v_subtotal, v_tax_total, v_subtotal + v_tax_total, 0,
    'draft', nullif(btrim(p_notes), ''), v_actor, p_idempotency_key, v_hash,
    v_currency, round(p_exchange_rate, 8), nullif(btrim(p_tax_code), ''),
    nullif(btrim(p_source_document_ref), ''), nullif(btrim(p_source_document_hash), '')
  );
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_qty := round((v_item->>'quantity')::numeric, 3);
    v_unit := round((v_item->>'unit_cost')::numeric, 2);
    v_tax := round(coalesce((v_item->>'tax_amount')::numeric, 0), 2);
    insert into public.restaurant_bill_items (
      bill_id, lodge_id, description, quantity, unit_cost, total, tax_amount,
      inventory_item_id, category, expense_account_id, tax_code, tax_rate, tax_treatment, source_line_ref
    ) values (
      v_bill_id, p_lodge_id, btrim(v_item->>'description'), v_qty, v_unit,
      round(v_qty * v_unit, 2), v_tax, nullif(v_item->>'inventory_item_id', '')::uuid,
      nullif(btrim(v_item->>'category'), ''), (v_item->>'expense_account_id')::uuid,
      nullif(btrim(v_item->>'tax_code'), ''), nullif(v_item->>'tax_rate', '')::numeric, v_treatment,
      nullif(btrim(v_item->>'source_line_ref'), '')
    );
  end loop;
  if p_source_document_hash is not null or p_source_document_ref is not null then
    if nullif(btrim(p_source_document_hash), '') is null then
      raise exception 'A source document hash is required when bill evidence is supplied' using errcode = '22023';
    end if;
    insert into public.restaurant_ap_document_evidence(
      lodge_id, bill_id, document_type, document_ref, content_hash, description, created_by
    ) values (
      p_lodge_id, v_bill_id, 'supplier_invoice', nullif(btrim(p_source_document_ref), ''),
      btrim(p_source_document_hash), 'Supplier invoice evidence', v_actor
    );
  end if;
  perform public.log_restaurant_financial_action(
    p_lodge_id, 'ap_bill.created', 'restaurant_bills', v_bill_id, null,
    jsonb_build_object('total', v_subtotal + v_tax_total, 'currency', v_currency,
      'source_document_hash', nullif(btrim(p_source_document_hash), '')),
    jsonb_build_object('idempotency_key', p_idempotency_key, 'payload_hash', v_hash)
  );
  return jsonb_build_object('success', true, 'data', jsonb_build_object('id', v_bill_id, 'replayed', false));
end
$$;
commit;
