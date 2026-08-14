-- AP-02/AP-05: complete the authoritative supplier subledger without
-- replacing the existing v2 bill/payment contract. Purchasing/PO/GRN matching
-- is intentionally conditional: this repository has no authoritative PO/GRN
-- tables, so no match is asserted for a lodge that has not enabled purchasing.

begin;

alter table public.restaurant_bills
  add column if not exists currency text not null default 'BWP',
  add column if not exists exchange_rate numeric(18,8) not null default 1,
  add column if not exists tax_code text,
  add column if not exists source_document_ref text,
  add column if not exists source_document_hash text;

alter table public.restaurant_bill_items
  add column if not exists tax_code text,
  add column if not exists tax_rate numeric(8,4),
  add column if not exists source_line_ref text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.restaurant_bills'::regclass
       and conname = 'restaurant_bills_currency_check'
  ) then
    alter table public.restaurant_bills
      add constraint restaurant_bills_currency_check
      check (currency = upper(currency) and currency ~ '^[A-Z]{3}$');
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.restaurant_bills'::regclass
       and conname = 'restaurant_bills_exchange_rate_check'
  ) then
    alter table public.restaurant_bills
      add constraint restaurant_bills_exchange_rate_check
      check (exchange_rate > 0);
  end if;
end
$$;

create table if not exists public.restaurant_ap_document_evidence (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  bill_id uuid not null references public.restaurant_bills(id) on delete restrict,
  credit_note_id uuid,
  document_type text not null check (document_type in ('supplier_invoice','credit_note','po','grn','other')),
  document_ref text,
  content_hash text not null,
  description text,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  unique (lodge_id, bill_id, document_type, content_hash)
);
alter table public.restaurant_ap_document_evidence enable row level security;
revoke all on table public.restaurant_ap_document_evidence from public, anon, authenticated;
grant select, insert on table public.restaurant_ap_document_evidence to service_role;
create index if not exists restaurant_ap_document_evidence_bill_idx
  on public.restaurant_ap_document_evidence(lodge_id, bill_id, created_at desc);

create table if not exists public.restaurant_ap_credit_notes (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  bill_id uuid not null references public.restaurant_bills(id) on delete restrict,
  supplier_id uuid references public.restaurant_suppliers(id) on delete set null,
  note_number text not null,
  note_date date not null,
  subtotal numeric(15,2) not null default 0 check (subtotal >= 0),
  tax_amount numeric(15,2) not null default 0 check (tax_amount >= 0),
  total numeric(15,2) not null default 0 check (total = round(subtotal + tax_amount, 2)),
  currency text not null default 'BWP',
  reason text not null,
  source_document_ref text,
  source_document_hash text,
  status text not null default 'draft'
    check (status in ('draft','submitted','approved','voided')),
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  submitted_by uuid references public.users(id),
  submitted_at timestamptz,
  approved_by uuid references public.users(id),
  approved_at timestamptz,
  reversal_journal_entry_id uuid references public.restaurant_journal_entries(id) on delete restrict,
  creation_idempotency_key text,
  creation_payload_hash text,
  approval_idempotency_key text,
  approval_payload_hash text
);
alter table public.restaurant_ap_credit_notes enable row level security;
revoke all on table public.restaurant_ap_credit_notes from public, anon, authenticated;
grant select, insert, update on table public.restaurant_ap_credit_notes to service_role;
create unique index if not exists restaurant_ap_credit_notes_number_uidx
  on public.restaurant_ap_credit_notes(lodge_id, bill_id, lower(note_number))
  where status <> 'voided';
create unique index if not exists restaurant_ap_credit_notes_creation_uidx
  on public.restaurant_ap_credit_notes(lodge_id, creation_idempotency_key)
  where creation_idempotency_key is not null;

create table if not exists public.restaurant_ap_credit_note_items (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  credit_note_id uuid not null references public.restaurant_ap_credit_notes(id) on delete cascade,
  description text not null,
  quantity numeric(10,3) not null default 1 check (quantity > 0),
  unit_cost numeric(15,2) not null default 0 check (unit_cost >= 0),
  subtotal numeric(15,2) not null default 0 check (subtotal >= 0),
  tax_amount numeric(15,2) not null default 0 check (tax_amount >= 0),
  tax_code text,
  expense_account_id uuid not null references public.restaurant_accounts(id) on delete restrict
);
alter table public.restaurant_ap_credit_note_items enable row level security;
revoke all on table public.restaurant_ap_credit_note_items from public, anon, authenticated;
grant select, insert on table public.restaurant_ap_credit_note_items to service_role;
create index if not exists restaurant_ap_credit_note_items_note_idx
  on public.restaurant_ap_credit_note_items(lodge_id, credit_note_id);

alter table public.restaurant_ap_document_evidence
  drop constraint if exists restaurant_ap_document_evidence_credit_note_fk;
alter table public.restaurant_ap_document_evidence
  add constraint restaurant_ap_document_evidence_credit_note_fk
  foreign key (credit_note_id) references public.restaurant_ap_credit_notes(id) on delete restrict;

-- New bill contract: the existing v2 signature remains a compatibility wrapper
-- with BWP/1.0 and no document metadata.
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
  v_qty numeric; v_unit numeric; v_line numeric; v_tax numeric; v_tax_rate numeric;
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
      inventory_item_id, category, expense_account_id, tax_code, tax_rate, source_line_ref
    ) values (
      v_bill_id, p_lodge_id, btrim(v_item->>'description'), v_qty, v_unit,
      round(v_qty * v_unit, 2), v_tax, nullif(v_item->>'inventory_item_id', '')::uuid,
      nullif(btrim(v_item->>'category'), ''), (v_item->>'expense_account_id')::uuid,
      nullif(btrim(v_item->>'tax_code'), ''), nullif(v_item->>'tax_rate', '')::numeric,
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

create or replace function public.create_restaurant_bill_v2(
  p_lodge_id uuid, p_supplier_id uuid, p_supplier_name text, p_bill_number text,
  p_bill_date date, p_due_date date, p_notes text, p_items jsonb, p_idempotency_key text
)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return public.create_restaurant_bill_v3(
    p_lodge_id, p_supplier_id, p_supplier_name, p_bill_number, p_bill_date,
    p_due_date, p_notes, p_items, p_idempotency_key, 'BWP', 1, null, null, null
  );
end
$$;

-- Submission is a state transition, so a retry after an ambiguous response must
-- resolve the committed state instead of converting success into a client error.
create or replace function public.submit_restaurant_bill(p_lodge_id uuid, p_bill_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_actor uuid; v_bill public.restaurant_bills%rowtype;
begin
  v_actor := public._restaurant_require_capability(p_lodge_id, 'accounting.manage');
  select * into v_bill from public.restaurant_bills where id = p_bill_id and lodge_id = p_lodge_id for update;
  if not found then raise exception 'Bill not found' using errcode = 'P0002'; end if;
  if v_bill.status in ('submitted','approved','partially_paid','paid','overdue') then
    return jsonb_build_object('success', true, 'data', jsonb_build_object('id', p_bill_id, 'status', v_bill.status, 'replayed', true));
  end if;
  if v_bill.status <> 'draft' then raise exception 'Only a draft bill can be submitted' using errcode = '22023'; end if;
  if v_bill.total <= 0 or not exists(select 1 from public.restaurant_bill_items where bill_id = p_bill_id and lodge_id = p_lodge_id) then
    raise exception 'Bill has no valid payable lines' using errcode = '23514';
  end if;
  update public.restaurant_bills set status = 'submitted', updated_at = now() where id = p_bill_id;
  perform public.log_restaurant_financial_action(
    p_lodge_id, 'ap_bill.submitted', 'restaurant_bills', p_bill_id,
    jsonb_build_object('status', 'draft'), jsonb_build_object('status', 'submitted'),
    jsonb_build_object('actor_id', v_actor)
  );
  return jsonb_build_object('success', true, 'data', jsonb_build_object('id', p_bill_id, 'status', 'submitted', 'replayed', false));
end
$$;

create or replace function public.create_restaurant_ap_credit_note_v2(
  p_lodge_id uuid, p_bill_id uuid, p_note_number text, p_note_date date,
  p_reason text, p_items jsonb, p_source_document_ref text,
  p_source_document_hash text, p_idempotency_key text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid; v_id uuid := gen_random_uuid(); v_item jsonb; v_hash text; v_existing record;
  v_bill public.restaurant_bills%rowtype; v_qty numeric; v_unit numeric; v_subtotal numeric := 0; v_tax numeric := 0;
  v_line numeric; v_item_tax numeric; v_existing_credits numeric;
begin
  v_actor := public._restaurant_require_capability(p_lodge_id, 'accounting.manage');
  if p_bill_id is null or nullif(btrim(p_note_number), '') is null or p_note_date is null
     or nullif(btrim(p_reason), '') is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 or nullif(btrim(p_idempotency_key), '') is null
     or nullif(btrim(p_source_document_hash), '') is null then
    raise exception 'Bill, note number/date, reason, lines, document hash and idempotency key are required' using errcode = '22023';
  end if;
  v_hash := encode(digest(jsonb_build_object(
    'bill_id', p_bill_id, 'note_number', btrim(p_note_number), 'note_date', p_note_date,
    'reason', btrim(p_reason), 'items', p_items,
    'source_document_ref', nullif(btrim(p_source_document_ref), ''),
    'source_document_hash', btrim(p_source_document_hash)
  )::text, 'sha256'), 'hex');
  select id, creation_payload_hash into v_existing
    from public.restaurant_ap_credit_notes
   where lodge_id = p_lodge_id and creation_idempotency_key = p_idempotency_key
   for update;
  if found then
    if v_existing.creation_payload_hash is distinct from v_hash then
      raise exception 'Credit-note idempotency key conflicts with a different payload' using errcode = '23505';
    end if;
    return jsonb_build_object('success', true, 'data', jsonb_build_object('id', v_existing.id, 'replayed', true));
  end if;
  select * into v_bill from public.restaurant_bills where id = p_bill_id and lodge_id = p_lodge_id for update;
  if not found or v_bill.status in ('draft', 'submitted', 'cancelled') then
    raise exception 'Credit notes require a recognized, non-cancelled supplier bill' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.restaurant_ap_credit_notes
     where lodge_id = p_lodge_id and bill_id = p_bill_id
       and lower(note_number) = lower(btrim(p_note_number)) and status <> 'voided'
  ) then
    raise exception 'Credit-note number already exists for this bill' using errcode = '23505';
  end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_qty := round(coalesce((v_item->>'quantity')::numeric, 0), 3);
    v_unit := round(coalesce((v_item->>'unit_cost')::numeric, 0), 2);
    v_item_tax := round(coalesce((v_item->>'tax_amount')::numeric, 0), 2);
    if v_qty <= 0 or v_unit < 0 or v_item_tax < 0
       or nullif(btrim(v_item->>'description'), '') is null then
      raise exception 'Every credit-note line requires description, positive quantity, valid cost and tax' using errcode = '22023';
    end if;
    if not exists (
      select 1 from public.restaurant_accounts
       where id = nullif(v_item->>'expense_account_id', '')::uuid
         and lodge_id = p_lodge_id and is_active and account_type in ('asset', 'expense')
    ) then
      raise exception 'Credit-note line account must be an active lodge asset or expense' using errcode = '23503';
    end if;
    v_line := round(v_qty * v_unit, 2); v_subtotal := v_subtotal + v_line; v_tax := v_tax + v_item_tax;
  end loop;
  select coalesce(sum(total), 0) into v_existing_credits
    from public.restaurant_ap_credit_notes
   where lodge_id = p_lodge_id and bill_id = p_bill_id and status in ('draft','submitted','approved');
  if round(v_subtotal + v_tax, 2) > round(v_bill.total - v_bill.amount_paid - v_existing_credits, 2) then
    raise exception 'Credit note exceeds the bill balance after payments and existing credit notes' using errcode = '23514';
  end if;
  insert into public.restaurant_ap_credit_notes(
    id, lodge_id, bill_id, supplier_id, note_number, note_date, subtotal, tax_amount, total,
    currency, reason, source_document_ref, source_document_hash, created_by,
    creation_idempotency_key, creation_payload_hash
  ) values (
    v_id, p_lodge_id, p_bill_id, v_bill.supplier_id, btrim(p_note_number), p_note_date,
    v_subtotal, v_tax, v_subtotal + v_tax, v_bill.currency, btrim(p_reason),
    nullif(btrim(p_source_document_ref), ''), btrim(p_source_document_hash), v_actor,
    p_idempotency_key, v_hash
  );
  for v_item in select value from jsonb_array_elements(p_items) loop
    insert into public.restaurant_ap_credit_note_items(
      lodge_id, credit_note_id, description, quantity, unit_cost, subtotal, tax_amount,
      tax_code, expense_account_id
    ) values (
      p_lodge_id, v_id, btrim(v_item->>'description'), round((v_item->>'quantity')::numeric, 3),
      round((v_item->>'unit_cost')::numeric, 2),
      round((v_item->>'quantity')::numeric * (v_item->>'unit_cost')::numeric, 2),
      round(coalesce((v_item->>'tax_amount')::numeric, 0), 2),
      nullif(btrim(v_item->>'tax_code'), ''), (v_item->>'expense_account_id')::uuid
    );
  end loop;
  insert into public.restaurant_ap_document_evidence(
    lodge_id, bill_id, credit_note_id, document_type, document_ref, content_hash,
    description, created_by
  ) values (
    p_lodge_id, p_bill_id, v_id, 'credit_note', nullif(btrim(p_source_document_ref), ''),
    btrim(p_source_document_hash), 'Supplier credit note evidence', v_actor
  );
  perform public.log_restaurant_financial_action(
    p_lodge_id, 'ap_credit_note.created', 'restaurant_ap_credit_notes', v_id, null,
    jsonb_build_object('bill_id', p_bill_id, 'total', v_subtotal + v_tax),
    jsonb_build_object('idempotency_key', p_idempotency_key, 'payload_hash', v_hash)
  );
  return jsonb_build_object('success', true, 'data', jsonb_build_object('id', v_id, 'replayed', false));
end
$$;

create or replace function public.submit_restaurant_ap_credit_note_v2(p_lodge_id uuid, p_credit_note_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_actor uuid; v_note public.restaurant_ap_credit_notes%rowtype;
begin
  v_actor := public._restaurant_require_capability(p_lodge_id, 'accounting.manage');
  select * into v_note from public.restaurant_ap_credit_notes where id = p_credit_note_id and lodge_id = p_lodge_id for update;
  if not found then raise exception 'Credit note not found' using errcode = 'P0002'; end if;
  if v_note.status in ('submitted', 'approved') then
    return jsonb_build_object('success', true, 'data', jsonb_build_object('id', p_credit_note_id, 'status', v_note.status, 'replayed', true));
  end if;
  if v_note.status <> 'draft' then raise exception 'Only a draft credit note can be submitted' using errcode = '22023'; end if;
  if not exists (select 1 from public.restaurant_ap_document_evidence where lodge_id = p_lodge_id and credit_note_id = p_credit_note_id) then
    raise exception 'Credit note document evidence is required before submission' using errcode = '23514';
  end if;
  update public.restaurant_ap_credit_notes set status = 'submitted', submitted_by = v_actor, submitted_at = now() where id = p_credit_note_id;
  perform public.log_restaurant_financial_action(
    p_lodge_id, 'ap_credit_note.submitted', 'restaurant_ap_credit_notes', p_credit_note_id,
    jsonb_build_object('status', 'draft'), jsonb_build_object('status', 'submitted'),
    jsonb_build_object('actor_id', v_actor)
  );
  return jsonb_build_object('success', true, 'data', jsonb_build_object('id', p_credit_note_id, 'status', 'submitted', 'replayed', false));
end
$$;

create or replace function public.approve_restaurant_ap_credit_note_v2(
  p_lodge_id uuid, p_credit_note_id uuid, p_idempotency_key text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid; v_note public.restaurant_ap_credit_notes%rowtype; v_bill public.restaurant_bills%rowtype;
  v_settings public.restaurant_ap_gl_settings%rowtype; v_lines jsonb; v_result jsonb; v_entry uuid; v_hash text; v_reserved_credits numeric := 0;
begin
  v_actor := public._restaurant_require_capability(p_lodge_id, 'accounting.manage');
  if nullif(btrim(p_idempotency_key), '') is null then raise exception 'Approval idempotency key is required' using errcode = '22023'; end if;
  select * into v_note from public.restaurant_ap_credit_notes where id = p_credit_note_id and lodge_id = p_lodge_id for update;
  if not found then raise exception 'Credit note not found' using errcode = 'P0002'; end if;
  if v_note.status = 'approved' and v_note.reversal_journal_entry_id is not null then
    return jsonb_build_object('success', true, 'data', jsonb_build_object('id', p_credit_note_id, 'journal_entry_id', v_note.reversal_journal_entry_id, 'replayed', true));
  end if;
  if v_note.status <> 'submitted' then raise exception 'Only a submitted credit note can be approved' using errcode = '22023'; end if;
  if v_note.created_by = v_actor then raise exception 'Credit-note creator cannot approve the same credit note' using errcode = '42501'; end if;
  select * into v_bill from public.restaurant_bills where id = v_note.bill_id and lodge_id = p_lodge_id for update;
  if not found or v_bill.status in ('draft', 'submitted', 'cancelled') then raise exception 'Credit note bill is not recognized' using errcode = '22023'; end if;
  select coalesce(sum(total), 0) into v_reserved_credits
    from public.restaurant_ap_credit_notes
   where lodge_id = p_lodge_id and bill_id = v_note.bill_id
     and id <> v_note.id and status in ('submitted', 'approved');
  if round(v_note.total, 2) > round(v_bill.total - v_bill.amount_paid - v_reserved_credits, 2) then
    raise exception 'Credit note exceeds the bill balance after payments and other pending credits' using errcode = '23514';
  end if;
  select * into v_settings from public.restaurant_ap_gl_settings where lodge_id = p_lodge_id;
  if not found or (v_note.tax_amount > 0 and v_settings.input_tax_account_id is null) then raise exception 'Complete AP GL settings before credit-note approval' using errcode = '23503'; end if;
  v_hash := encode(digest(jsonb_build_object('credit_note_id', p_credit_note_id, 'approval_key', p_idempotency_key, 'total', v_note.total)::text, 'sha256'), 'hex');
  if v_note.approval_idempotency_key is not null then
    if v_note.approval_payload_hash is distinct from v_hash then raise exception 'Credit-note approval key conflicts with a different payload' using errcode = '23505'; end if;
    return jsonb_build_object('success', true, 'data', jsonb_build_object('id', p_credit_note_id, 'journal_entry_id', v_note.reversal_journal_entry_id, 'replayed', true));
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('account_id', expense_account_id, 'debit', 0, 'credit', amount, 'memo', 'Supplier credit note')),'[]'::jsonb)
    into v_lines
    from (select expense_account_id, sum(subtotal) amount from public.restaurant_ap_credit_note_items where lodge_id = p_lodge_id and credit_note_id = p_credit_note_id group by expense_account_id)x
   where amount > 0;
  if v_note.tax_amount > 0 then v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_id', v_settings.input_tax_account_id, 'debit', 0, 'credit', v_note.tax_amount, 'memo', 'Reverse input tax')); end if;
  v_lines := jsonb_build_array(jsonb_build_object('account_id', v_settings.payable_account_id, 'debit', v_note.total, 'credit', 0, 'memo', 'Reduce accounts payable')) || v_lines;
  v_result := public._restaurant_post_journal(
    p_lodge_id, v_note.note_date, concat('Supplier credit note ', v_note.note_number),
    'ap_credit_note', v_note.id, v_note.note_number, 'ap-credit-note:' || v_note.id::text,
    v_lines, v_actor, null
  );
  v_entry := (v_result->'data'->>'entry_id')::uuid;
  update public.restaurant_ap_credit_notes
     set status = 'approved', approved_by = v_actor, approved_at = now(),
         reversal_journal_entry_id = v_entry, approval_idempotency_key = p_idempotency_key,
         approval_payload_hash = v_hash
   where id = p_credit_note_id;
  perform public.record_restaurant_source_posting(
    p_lodge_id, 'ap_credit_note', p_credit_note_id, v_note.note_date, v_entry,
    p_credit_note_id, v_hash, 1, null, 'posted'
  );
  perform public.log_restaurant_financial_action(
    p_lodge_id, 'ap_credit_note.approved', 'restaurant_ap_credit_notes', p_credit_note_id,
    null, jsonb_build_object('journal_entry_id', v_entry, 'total', v_note.total),
    jsonb_build_object('approval_payload_hash', v_hash)
  );
  return jsonb_build_object('success', true, 'data', jsonb_build_object('id', p_credit_note_id, 'journal_entry_id', v_entry, 'replayed', false));
end
$$;

-- Replace payment's balance check with the recognized AP balance after credits;
-- retain the v2 signature and canonical payload hash from the previous patch.
create or replace function public.record_restaurant_bill_payment_v2(
  p_lodge_id uuid, p_bill_id uuid, p_payment_date date, p_amount numeric,
  p_payment_account_id uuid, p_reference text, p_notes text, p_idempotency_key text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid; v_bill public.restaurant_bills%rowtype; v_settings public.restaurant_ap_gl_settings%rowtype;
  v_existing public.restaurant_bill_payments%rowtype; v_payment_id uuid := gen_random_uuid();
  v_result jsonb; v_entry uuid; v_hash text; v_credits numeric := 0; v_outstanding numeric;
begin
  v_actor := public._restaurant_require_capability(p_lodge_id, 'accounting.ap_pay');
  if p_payment_date is null or coalesce(p_amount, 0) <= 0 or p_payment_account_id is null or nullif(btrim(p_idempotency_key), '') is null then
    raise exception 'Payment date, positive amount, payment account and idempotency key are required' using errcode = '22023';
  end if;
  v_hash := encode(digest(jsonb_build_object(
    'bill_id', p_bill_id, 'payment_date', p_payment_date, 'amount', round(p_amount, 2),
    'payment_account_id', p_payment_account_id, 'reference', nullif(btrim(p_reference), ''),
    'notes', nullif(btrim(p_notes), ''), 'idempotency_key', p_idempotency_key
  )::text, 'sha256'), 'hex');
  select * into v_existing from public.restaurant_bill_payments where lodge_id = p_lodge_id and idempotency_key = p_idempotency_key for update;
  if found then
    if v_existing.payload_hash is null or v_existing.payload_hash <> v_hash then raise exception 'Payment idempotency key conflicts with a different or legacy payload; resolve the original payment before retrying' using errcode = '22000'; end if;
    return jsonb_build_object('success', true, 'data', jsonb_build_object('id', v_existing.id, 'replayed', true));
  end if;
  select * into v_bill from public.restaurant_bills where id = p_bill_id and lodge_id = p_lodge_id for update;
  if not found or v_bill.status not in ('approved', 'partially_paid', 'overdue') then raise exception 'Only approved outstanding bills are payable' using errcode = '22023'; end if;
  -- Submitted credit notes reserve the remaining payable even before their
  -- independent approval, preventing a payment from consuming the same
  -- balance that the pending correction is intended to reduce.
  select coalesce(sum(total), 0) into v_credits from public.restaurant_ap_credit_notes where lodge_id = p_lodge_id and bill_id = p_bill_id and status in ('submitted', 'approved');
  v_outstanding := greatest(v_bill.total - v_bill.amount_paid - v_credits, 0);
  if round(p_amount, 2) > round(v_outstanding, 2) then raise exception 'Payment exceeds outstanding balance after credit notes' using errcode = '23514'; end if;
  if not exists(select 1 from public.restaurant_accounts where id = p_payment_account_id and lodge_id = p_lodge_id and is_active and account_type = 'asset') then raise exception 'Payment account must be an active lodge asset' using errcode = '23503'; end if;
  select * into v_settings from public.restaurant_ap_gl_settings where lodge_id = p_lodge_id;
  if not found then raise exception 'AP GL settings are missing' using errcode = '23503'; end if;
  v_result := public._restaurant_post_journal(
    p_lodge_id, p_payment_date, concat('Payment ', v_bill.bill_number), 'ap_payment', v_payment_id,
    p_reference, concat('ap-payment:', p_idempotency_key),
    jsonb_build_array(
      jsonb_build_object('account_id', v_settings.payable_account_id, 'debit', round(p_amount, 2), 'credit', 0, 'memo', 'Reduce payable'),
      jsonb_build_object('account_id', p_payment_account_id, 'debit', 0, 'credit', round(p_amount, 2), 'memo', 'Supplier payment')
    ), v_actor, null
  );
  v_entry := (v_result->'data'->>'entry_id')::uuid;
  insert into public.restaurant_bill_payments(
    id, lodge_id, bill_id, payment_date, amount, payment_method, reference, notes,
    created_by, journal_entry_id, idempotency_key, payment_account_id, payload_hash
  ) values (
    v_payment_id, p_lodge_id, p_bill_id, p_payment_date, round(p_amount, 2), 'account',
    nullif(btrim(p_reference), ''), nullif(btrim(p_notes), ''), v_actor, v_entry,
    p_idempotency_key, p_payment_account_id, v_hash
  );
  update public.restaurant_bills
     set amount_paid = amount_paid + round(p_amount, 2),
         status = case when amount_paid + round(p_amount, 2) + v_credits >= total then 'paid' else 'partially_paid' end,
         updated_at = now()
   where id = p_bill_id;
  perform public.log_restaurant_financial_action(p_lodge_id, 'ap_payment.recorded', 'restaurant_bill_payments', v_payment_id, null,
    jsonb_build_object('bill_id', p_bill_id, 'amount', round(p_amount, 2), 'journal_entry_id', v_entry, 'payload_hash', v_hash), null);
  return jsonb_build_object('success', true, 'data', jsonb_build_object('id', v_payment_id, 'journal_entry_id', v_entry, 'replayed', false));
end
$$;

create or replace function public.get_restaurant_supplier_statement_v2(
  p_lodge_id uuid, p_supplier_name text, p_start_date date default null, p_end_date date default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid; v_settings public.restaurant_ap_gl_settings%rowtype; v_opening numeric := 0;
  v_rows jsonb; v_bill_total numeric := 0; v_payment_total numeric := 0; v_credit_total numeric := 0;
  v_outstanding numeric := 0; v_gl_balance numeric := 0; v_currency text;
begin
  v_actor := public._restaurant_require_capability(p_lodge_id, 'accounting.read');
  if nullif(btrim(p_supplier_name), '') is null then raise exception 'Supplier name is required' using errcode = '22023'; end if;
  if p_end_date is not null and p_start_date is not null and p_end_date < p_start_date then raise exception 'Supplier statement dates are invalid' using errcode = '22023'; end if;
  with events as (
    select b.bill_date event_date, b.id event_id, 'bill' event_type, b.bill_number reference, b.total debit, 0::numeric credit
      from public.restaurant_bills b where b.lodge_id = p_lodge_id and lower(b.supplier_name) = lower(btrim(p_supplier_name)) and b.status in ('approved','partially_paid','paid','overdue')
    union all
    select p.payment_date, p.id, 'payment', p.reference, 0, p.amount
      from public.restaurant_bill_payments p join public.restaurant_bills b on b.id = p.bill_id and b.lodge_id = p.lodge_id
     where p.lodge_id = p_lodge_id and lower(b.supplier_name) = lower(btrim(p_supplier_name))
    union all
    select n.note_date, n.id, 'credit_note', n.note_number, 0, n.total
      from public.restaurant_ap_credit_notes n join public.restaurant_bills b on b.id = n.bill_id and b.lodge_id = n.lodge_id
     where n.lodge_id = p_lodge_id and n.status = 'approved' and lower(b.supplier_name) = lower(btrim(p_supplier_name))
  )
  select coalesce(sum(debit - credit), 0) into v_opening from events where p_start_date is not null and event_date < p_start_date;
  with events as (
    select b.bill_date event_date, b.id event_id, 'bill' event_type, b.bill_number reference, b.total debit, 0::numeric credit
      from public.restaurant_bills b where b.lodge_id = p_lodge_id and lower(b.supplier_name) = lower(btrim(p_supplier_name)) and b.status in ('approved','partially_paid','paid','overdue')
    union all
    select p.payment_date, p.id, 'payment', p.reference, 0, p.amount
      from public.restaurant_bill_payments p join public.restaurant_bills b on b.id = p.bill_id and b.lodge_id = p.lodge_id
     where p.lodge_id = p_lodge_id and lower(b.supplier_name) = lower(btrim(p_supplier_name))
    union all
    select n.note_date, n.id, 'credit_note', n.note_number, 0, n.total
      from public.restaurant_ap_credit_notes n join public.restaurant_bills b on b.id = n.bill_id and b.lodge_id = n.lodge_id
     where n.lodge_id = p_lodge_id and n.status = 'approved' and lower(b.supplier_name) = lower(btrim(p_supplier_name))
  ), period_events as (
    select * from events where (p_start_date is null or event_date >= p_start_date) and (p_end_date is null or event_date <= p_end_date)
  ), running as (
    select e.*, v_opening + sum(e.debit - e.credit) over(order by e.event_date, e.event_type, e.event_id rows between unbounded preceding and current row) balance
      from period_events e
  )
  select coalesce(jsonb_agg(jsonb_build_object('event_date', event_date, 'event_id', event_id, 'event_type', event_type, 'reference', reference, 'debit', round(debit,2), 'credit', round(credit,2), 'balance', round(balance,2)) order by event_date, event_type, event_id), '[]'::jsonb)
    into v_rows from running;
  select coalesce(sum(total),0) into v_bill_total from public.restaurant_bills where lodge_id = p_lodge_id and lower(supplier_name) = lower(btrim(p_supplier_name)) and status in ('approved','partially_paid','paid','overdue') and (p_end_date is null or bill_date <= p_end_date);
  select coalesce(sum(p.amount),0) into v_payment_total from public.restaurant_bill_payments p join public.restaurant_bills b on b.id = p.bill_id and b.lodge_id = p.lodge_id where p.lodge_id = p_lodge_id and lower(b.supplier_name) = lower(btrim(p_supplier_name)) and (p_end_date is null or p.payment_date <= p_end_date);
  select coalesce(sum(n.total),0) into v_credit_total from public.restaurant_ap_credit_notes n join public.restaurant_bills b on b.id = n.bill_id and b.lodge_id = n.lodge_id where n.lodge_id = p_lodge_id and n.status = 'approved' and lower(b.supplier_name) = lower(btrim(p_supplier_name)) and (p_end_date is null or n.note_date <= p_end_date);
  v_outstanding := round(v_bill_total - v_payment_total - v_credit_total, 2);
  select case when count(distinct b.currency) = 1 then min(b.currency) else 'MIXED' end
    into v_currency
    from public.restaurant_bills b
   where b.lodge_id = p_lodge_id and lower(b.supplier_name) = lower(btrim(p_supplier_name))
     and b.status in ('approved','partially_paid','paid','overdue')
     and (p_end_date is null or b.bill_date <= p_end_date);
  select * into v_settings from public.restaurant_ap_gl_settings where lodge_id = p_lodge_id;
  if found then
    select coalesce(sum(l.credit - l.debit), 0) into v_gl_balance
      from public.restaurant_journal_entries e join public.restaurant_journal_lines l on l.entry_id = e.id
     where e.lodge_id = p_lodge_id and e.is_posted and l.account_id = v_settings.payable_account_id
       and (p_end_date is null or e.entry_date <= p_end_date)
       and (
         (e.source_type = 'ap_bill' and exists (select 1 from public.restaurant_bills b where b.id = e.source_id and b.lodge_id = p_lodge_id and lower(b.supplier_name) = lower(btrim(p_supplier_name))))
         or (e.source_type = 'ap_payment' and exists (select 1 from public.restaurant_bill_payments bp join public.restaurant_bills b on b.id = bp.bill_id and b.lodge_id = bp.lodge_id where bp.id = e.source_id and bp.lodge_id = p_lodge_id and lower(b.supplier_name) = lower(btrim(p_supplier_name))))
         or (e.source_type = 'ap_credit_note' and exists (select 1 from public.restaurant_ap_credit_notes cn join public.restaurant_bills b on b.id = cn.bill_id and b.lodge_id = cn.lodge_id where cn.id = e.source_id and cn.lodge_id = p_lodge_id and lower(b.supplier_name) = lower(btrim(p_supplier_name))))
       );
  end if;
  return jsonb_build_object('success', true, 'data', jsonb_build_object(
    'schema_version', 'ap-supplier-statement-v1', 'supplier_name', btrim(p_supplier_name),
    'period_start', p_start_date, 'period_end', p_end_date, 'currency', coalesce(v_currency, 'BWP'),
    'opening_balance', round(v_opening,2), 'rows', v_rows,
    'control_totals', jsonb_build_object('recognized_bills', round(v_bill_total,2), 'payments', round(v_payment_total,2), 'credit_notes', round(v_credit_total,2), 'outstanding', v_outstanding),
    'reconciliation', jsonb_build_object('ap_subledger_balance', v_outstanding, 'ap_control_account_balance', round(v_gl_balance,2), 'difference', round(v_outstanding-v_gl_balance,2), 'status', case when round(v_outstanding-v_gl_balance,2)=0 then 'reconciled' else 'exception' end),
    'source_policy', jsonb_build_object('recognized_statuses', jsonb_build_array('approved','partially_paid','paid','overdue'), 'po_grn_matching', 'not_asserted_without_purchasing_source_tables')
  ));
end
$$;

-- Authoritative AP workspace and export now expose evidence, credits and
-- recognized-only balances while preserving the existing response envelope.
create or replace function public.get_restaurant_ap_workspace_v2(p_lodge_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public._restaurant_require_capability(p_lodge_id, 'accounting.read');
  return jsonb_build_object('success', true, 'data', jsonb_build_object(
    'bills', coalesce((select jsonb_agg(
      to_jsonb(b) || jsonb_build_object(
        'credited_amount', coalesce((select sum(n.total) from public.restaurant_ap_credit_notes n where n.bill_id = b.id and n.lodge_id = p_lodge_id and n.status = 'approved'),0),
        'outstanding', greatest(b.total - b.amount_paid - coalesce((select sum(n.total) from public.restaurant_ap_credit_notes n where n.bill_id = b.id and n.lodge_id = p_lodge_id and n.status = 'approved'),0),0),
        'items', coalesce((select jsonb_agg(to_jsonb(i) order by i.id) from public.restaurant_bill_items i where i.bill_id = b.id and i.lodge_id = p_lodge_id),'[]'::jsonb),
        'payments', coalesce((select jsonb_agg(to_jsonb(bp) order by bp.payment_date, bp.created_at) from public.restaurant_bill_payments bp where bp.bill_id = b.id and bp.lodge_id = p_lodge_id),'[]'::jsonb),
        'credit_notes', coalesce((select jsonb_agg(to_jsonb(n) || jsonb_build_object('items', coalesce((select jsonb_agg(to_jsonb(ni) order by ni.id) from public.restaurant_ap_credit_note_items ni where ni.credit_note_id = n.id and ni.lodge_id = p_lodge_id),'[]'::jsonb)) order by n.note_date, n.created_at) from public.restaurant_ap_credit_notes n where n.bill_id = b.id and n.lodge_id = p_lodge_id),'[]'::jsonb),
        'evidence', coalesce((select jsonb_agg(to_jsonb(ev) order by ev.created_at) from public.restaurant_ap_document_evidence ev where ev.bill_id = b.id and ev.lodge_id = p_lodge_id),'[]'::jsonb)
      ) order by b.bill_date desc, b.created_at desc) from public.restaurant_bills b where b.lodge_id = p_lodge_id),'[]'::jsonb),
    'summary', coalesce((select jsonb_build_object(
      'total_outstanding', round(coalesce(sum(greatest(b.total - b.amount_paid - coalesce((select sum(n.total) from public.restaurant_ap_credit_notes n where n.bill_id = b.id and n.lodge_id = p_lodge_id and n.status = 'approved'),0),0)) filter (where b.status in ('approved','partially_paid','overdue')),0),2),
      'overdue_outstanding', round(coalesce(sum(case when b.due_date < public.get_lodge_business_date(p_lodge_id) and b.status in ('approved','partially_paid','overdue') then greatest(b.total - b.amount_paid - coalesce((select sum(n.total) from public.restaurant_ap_credit_notes n where n.bill_id = b.id and n.lodge_id = p_lodge_id and n.status = 'approved'),0),0) else 0 end),0),2),
      'open_bills', count(*) filter (where b.status in ('approved','partially_paid','overdue')),
      'unrecognized_bills', count(*) filter (where b.status in ('draft','submitted')),
      'credit_notes', count(*) filter (where exists (select 1 from public.restaurant_ap_credit_notes n where n.bill_id = b.id and n.lodge_id = p_lodge_id and n.status = 'approved'))
    ) from public.restaurant_bills b where b.lodge_id = p_lodge_id),'{}'::jsonb),
    'controls', jsonb_build_object(
      'recognized_statuses', jsonb_build_array('approved','partially_paid','overdue','paid'),
      'drafts_excluded_from_liability', true,
      'credits_reduce_payable_before_payment', true,
      'document_evidence_required_for_credit_notes', true,
      'po_grn_matching', 'conditional_not_asserted_without_purchasing_source_tables'
    )
  ));
end
$$;

revoke all on function public.create_restaurant_bill_v3(uuid,uuid,text,text,date,date,text,jsonb,text,text,numeric,text,text,text) from public, anon, authenticated;
revoke all on function public.create_restaurant_bill_v2(uuid,uuid,text,text,date,date,text,jsonb,text) from public, anon, authenticated;
revoke all on function public.create_restaurant_ap_credit_note_v2(uuid,uuid,text,date,text,jsonb,text,text,text) from public, anon, authenticated;
revoke all on function public.submit_restaurant_ap_credit_note_v2(uuid,uuid) from public, anon, authenticated;
revoke all on function public.approve_restaurant_ap_credit_note_v2(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.record_restaurant_bill_payment_v2(uuid,uuid,date,numeric,uuid,text,text,text) from public, anon, authenticated;
revoke all on function public.get_restaurant_supplier_statement_v2(uuid,text,date,date) from public, anon, authenticated;
revoke all on function public.get_restaurant_ap_workspace_v2(uuid) from public, anon, authenticated;
grant execute on function public.create_restaurant_bill_v3(uuid,uuid,text,text,date,date,text,jsonb,text,text,numeric,text,text,text) to service_role;
grant execute on function public.create_restaurant_bill_v2(uuid,uuid,text,text,date,date,text,jsonb,text) to service_role;
grant execute on function public.create_restaurant_ap_credit_note_v2(uuid,uuid,text,date,text,jsonb,text,text,text) to service_role;
grant execute on function public.submit_restaurant_ap_credit_note_v2(uuid,uuid) to service_role;
grant execute on function public.approve_restaurant_ap_credit_note_v2(uuid,uuid,text) to service_role;
grant execute on function public.record_restaurant_bill_payment_v2(uuid,uuid,date,numeric,uuid,text,text,text) to service_role;
grant execute on function public.get_restaurant_supplier_statement_v2(uuid,text,date,date) to service_role;
grant execute on function public.get_restaurant_ap_workspace_v2(uuid) to service_role;

commit;
