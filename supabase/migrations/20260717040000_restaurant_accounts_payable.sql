begin;

-- ============================================================
-- Restaurant Accounts Payable
-- Bills, line items, payments, aging, summary
-- ============================================================

-- ── Restaurant Bills ──────────────────────────────────────────
create table if not exists public.restaurant_bills (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  supplier_id uuid references public.restaurant_suppliers(id) on delete set null,
  supplier_name text not null,
  bill_number text,
  bill_date date not null,
  due_date date not null,
  subtotal numeric(15,2) not null default 0,
  tax_amount numeric(15,2) not null default 0,
  total numeric(15,2) not null default 0,
  amount_paid numeric(15,2) not null default 0,
  status text not null default 'draft'
    check (status in ('draft','submitted','approved','partially_paid','paid','overdue','cancelled')),
  notes text,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.restaurant_bills enable row level security;

create policy restaurant_bills_lodge_scope_select on public.restaurant_bills
  for select using (public.app_lodge_access(lodge_id));

create policy restaurant_bills_lodge_scope_insert on public.restaurant_bills
  for insert with check (public.app_lodge_access(lodge_id));

create policy restaurant_bills_lodge_scope_update on public.restaurant_bills
  for update using (public.app_lodge_access(lodge_id));

create policy restaurant_bills_lodge_scope_delete on public.restaurant_bills
  for delete using (public.app_lodge_access(lodge_id));

-- ── Restaurant Bill Items ─────────────────────────────────────
create table if not exists public.restaurant_bill_items (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.restaurant_bills(id) on delete cascade,
  description text not null,
  quantity numeric(10,3) not null default 1,
  unit_cost numeric(15,2) not null default 0,
  total numeric(15,2) not null default 0,
  inventory_item_id uuid references public.inventory_items(id) on delete set null,
  category text
);

-- Bill items inherit lodge_id via the parent bill for RLS.
-- We add a denormalised lodge_id column for policy support.
alter table public.restaurant_bill_items add column if not exists lodge_id uuid
  references public.settings(lodge_id) on delete cascade;

alter table public.restaurant_bill_items enable row level security;

create policy restaurant_bill_items_lodge_scope_select on public.restaurant_bill_items
  for select using (public.app_lodge_access(lodge_id));

create policy restaurant_bill_items_lodge_scope_insert on public.restaurant_bill_items
  for insert with check (public.app_lodge_access(lodge_id));

create policy restaurant_bill_items_lodge_scope_update on public.restaurant_bill_items
  for update using (public.app_lodge_access(lodge_id));

create policy restaurant_bill_items_lodge_scope_delete on public.restaurant_bill_items
  for delete using (public.app_lodge_access(lodge_id));

-- ── Restaurant Bill Payments ──────────────────────────────────
create table if not exists public.restaurant_bill_payments (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  bill_id uuid not null references public.restaurant_bills(id) on delete cascade,
  payment_date date not null,
  amount numeric(15,2) not null,
  payment_method text not null default 'bank_transfer',
  reference text,
  notes text,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);

alter table public.restaurant_bill_payments enable row level security;

create policy restaurant_bill_payments_lodge_scope_select on public.restaurant_bill_payments
  for select using (public.app_lodge_access(lodge_id));

create policy restaurant_bill_payments_lodge_scope_insert on public.restaurant_bill_payments
  for insert with check (public.app_lodge_access(lodge_id));

create policy restaurant_bill_payments_lodge_scope_update on public.restaurant_bill_payments
  for update using (public.app_lodge_access(lodge_id));

create policy restaurant_bill_payments_lodge_scope_delete on public.restaurant_bill_payments
  for delete using (public.app_lodge_access(lodge_id));

-- ── Indexes ───────────────────────────────────────────────────
create index if not exists idx_restaurant_bills_lodge_status
  on public.restaurant_bills (lodge_id, status);

create index if not exists idx_restaurant_bills_lodge_due_date
  on public.restaurant_bills (lodge_id, due_date);

create index if not exists idx_restaurant_bill_items_bill_id
  on public.restaurant_bill_items (bill_id);

create index if not exists idx_restaurant_bill_payments_bill_id
  on public.restaurant_bill_payments (bill_id);

create index if not exists idx_restaurant_bill_payments_lodge_id
  on public.restaurant_bill_payments (lodge_id);

-- ============================================================
-- RPCs
-- ============================================================

-- ── get_restaurant_bills ──────────────────────────────────────
create or replace function public.get_restaurant_bills(
  p_lodge_id uuid,
  p_status text default null,
  p_start_date date default null,
  p_end_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  perform public.app_require_feature(p_lodge_id, 'restaurant_accounting', ARRAY['admin', 'super_admin', 'manager', 'finance']);

  select jsonb_agg(
    jsonb_build_object(
      'id', b.id,
      'supplier_id', b.supplier_id,
      'supplier_name', b.supplier_name,
      'bill_number', b.bill_number,
      'bill_date', b.bill_date,
      'due_date', b.due_date,
      'subtotal', b.subtotal,
      'tax_amount', b.tax_amount,
      'total', b.total,
      'amount_paid', b.amount_paid,
      'status', b.status,
      'notes', b.notes,
      'created_by', b.created_by,
      'created_at', b.created_at,
      'updated_at', b.updated_at,
      'items', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', bi.id,
            'description', bi.description,
            'quantity', bi.quantity,
            'unit_cost', bi.unit_cost,
            'total', bi.total,
            'inventory_item_id', bi.inventory_item_id,
            'category', bi.category
          )
        )
        from public.restaurant_bill_items bi
        where bi.bill_id = b.id
      ), '[]'::jsonb)
    )
  ) into v_result
  from public.restaurant_bills b
  where b.lodge_id = p_lodge_id
    and (p_status is null or b.status = p_status)
    and (p_start_date is null or b.bill_date >= p_start_date)
    and (p_end_date is null or b.bill_date <= p_end_date)
  order by b.bill_date desc, b.created_at desc;

  return coalesce(v_result, '[]'::jsonb);
end;
$$;

-- ── create_restaurant_bill ────────────────────────────────────
create or replace function public.create_restaurant_bill(
  p_lodge_id uuid,
  p_supplier_id uuid,
  p_supplier_name text,
  p_bill_number text,
  p_bill_date date,
  p_due_date date,
  p_notes text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bill_id uuid;
  v_subtotal numeric := 0;
  v_tax numeric := 0;
  v_total numeric := 0;
  v_item jsonb;
  v_item_total numeric;
begin
  perform public.app_require_feature(p_lodge_id, 'restaurant_accounting', ARRAY['admin', 'super_admin', 'manager', 'finance']);

  if p_items is null or jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('success', false, 'error', 'At least one bill item is required');
  end if;

  if p_due_date < p_bill_date then
    return jsonb_build_object('success', false, 'error', 'Due date cannot be before bill date');
  end if;

  v_bill_id := gen_random_uuid();

  -- Calculate totals from items
  for v_item in select jsonb_array_elements(p_items)
  loop
    v_item_total := coalesce((v_item->>'total')::numeric, 0);
    v_subtotal := v_subtotal + v_item_total;
  end loop;

  -- Default tax at 0; caller can set tax via separate update if needed
  v_total := v_subtotal + v_tax;

  insert into public.restaurant_bills (
    id, lodge_id, supplier_id, supplier_name, bill_number,
    bill_date, due_date, subtotal, tax_amount, total,
    amount_paid, status, notes, created_by
  ) values (
    v_bill_id, p_lodge_id, p_supplier_id, p_supplier_name, p_bill_number,
    p_bill_date, p_due_date, v_subtotal, v_tax, v_total,
    0, 'draft', p_notes, auth.uid()
  );

  -- Insert bill items
  insert into public.restaurant_bill_items (
    id, bill_id, lodge_id, description, quantity, unit_cost, total,
    inventory_item_id, category
  )
  select
    coalesce((v_item->>'id')::uuid, gen_random_uuid()),
    v_bill_id,
    p_lodge_id,
    v_item->>'description',
    coalesce((v_item->>'quantity')::numeric, 1),
    coalesce((v_item->>'unit_cost')::numeric, 0),
    coalesce((v_item->>'total')::numeric, 0),
    (v_item->>'inventory_item_id')::uuid,
    v_item->>'category'
  from jsonb_array_elements(p_items) v_item;

  return jsonb_build_object('success', true, 'id', v_bill_id);
end;
$$;

-- ── update_restaurant_bill ────────────────────────────────────
create or replace function public.update_restaurant_bill(
  p_id uuid,
  p_lodge_id uuid,
  p_supplier_name text,
  p_bill_number text,
  p_bill_date date,
  p_due_date date,
  p_notes text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.app_require_feature(p_lodge_id, 'restaurant_accounting', ARRAY['admin', 'super_admin', 'manager', 'finance']);

  update public.restaurant_bills
  set
    supplier_name = coalesce(p_supplier_name, supplier_name),
    bill_number = coalesce(p_bill_number, bill_number),
    bill_date = coalesce(p_bill_date, bill_date),
    due_date = coalesce(p_due_date, due_date),
    notes = coalesce(p_notes, notes),
    updated_at = now()
  where id = p_id and lodge_id = p_lodge_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Bill not found');
  end if;

  return jsonb_build_object('success', true);
end;
$$;

-- ── update_bill_items ─────────────────────────────────────────
create or replace function public.update_bill_items(
  p_bill_id uuid,
  p_lodge_id uuid,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_subtotal numeric := 0;
  v_total numeric;
  v_bill record;
begin
  perform public.app_require_feature(p_lodge_id, 'restaurant_accounting', ARRAY['admin', 'super_admin', 'manager', 'finance']);

  select * into v_bill
  from public.restaurant_bills
  where id = p_bill_id and lodge_id = p_lodge_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Bill not found');
  end if;

  if v_bill.status not in ('draft', 'submitted') then
    return jsonb_build_object('success', false, 'error', 'Cannot edit items for a bill in ' || v_bill.status || ' status');
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('success', false, 'error', 'At least one bill item is required');
  end if;

  -- Delete existing items
  delete from public.restaurant_bill_items where bill_id = p_bill_id;

  -- Insert new items
  insert into public.restaurant_bill_items (
    id, bill_id, lodge_id, description, quantity, unit_cost, total,
    inventory_item_id, category
  )
  select
    coalesce((v_item->>'id')::uuid, gen_random_uuid()),
    p_bill_id,
    p_lodge_id,
    v_item->>'description',
    coalesce((v_item->>'quantity')::numeric, 1),
    coalesce((v_item->>'unit_cost')::numeric, 0),
    coalesce((v_item->>'total')::numeric, 0),
    (v_item->>'inventory_item_id')::uuid,
    v_item->>'category'
  from jsonb_array_elements(p_items) v_item;

  -- Recalculate totals
  select coalesce(sum(total), 0) into v_subtotal
  from public.restaurant_bill_items where bill_id = p_bill_id;

  v_total := v_subtotal + v_bill.tax_amount;

  update public.restaurant_bills
  set subtotal = v_subtotal, total = v_total, updated_at = now()
  where id = p_bill_id;

  return jsonb_build_object('success', true);
end;
$$;

-- ── update_bill_status ────────────────────────────────────────
create or replace function public.update_bill_status(
  p_id uuid,
  p_lodge_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bill record;
  v_valid_transition boolean;
begin
  perform public.app_require_feature(p_lodge_id, 'restaurant_accounting', ARRAY['admin', 'super_admin', 'manager', 'finance']);

  select * into v_bill
  from public.restaurant_bills
  where id = p_id and lodge_id = p_lodge_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Bill not found');
  end if;

  -- 'paid' status must only be set by record_bill_payment
  if p_status = 'paid' then
    return jsonb_build_object('success', false, 'error', 'Use record_bill_payment to mark bills as paid');
  end if;

  -- Validate transition
  v_valid_transition := case v_bill.status
    when 'draft'          then p_status in ('submitted')
    when 'submitted'      then p_status in ('approved')
    when 'approved'       then p_status in ('overdue')
    when 'paid'           then false
    when 'cancelled'      then false
    else false
  end;

  if not v_valid_transition then
    return jsonb_build_object('success', false, 'error', 'Cannot transition from ' || v_bill.status || ' to ' || p_status);
  end if;

  update public.restaurant_bills
  set status = p_status, updated_at = now()
  where id = p_id;

  return jsonb_build_object('success', true);
end;
$$;

-- ── record_bill_payment ───────────────────────────────────────
create or replace function public.record_bill_payment(
  p_bill_id uuid,
  p_lodge_id uuid,
  p_payment_date date,
  p_amount numeric,
  p_payment_method text,
  p_reference text,
  p_notes text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bill record;
  v_payment_id uuid;
  v_new_amount_paid numeric;
  v_new_status text;
begin
  perform public.app_require_feature(p_lodge_id, 'restaurant_accounting', ARRAY['admin', 'super_admin', 'manager', 'finance']);

  select * into v_bill
  from public.restaurant_bills
  where id = p_bill_id and lodge_id = p_lodge_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Bill not found');
  end if;

  if v_bill.status in ('draft', 'cancelled') then
    return jsonb_build_object('success', false, 'error', 'Cannot record payment for a bill in ' || v_bill.status || ' status');
  end if;

  if p_amount <= 0 then
    return jsonb_build_object('success', false, 'error', 'Payment amount must be greater than zero');
  end if;

  v_payment_id := gen_random_uuid();
  v_new_amount_paid := v_bill.amount_paid + p_amount;

  insert into public.restaurant_bill_payments (
    id, lodge_id, bill_id, payment_date, amount, payment_method,
    reference, notes, created_by
  ) values (
    v_payment_id, p_lodge_id, p_bill_id, p_payment_date, p_amount,
    coalesce(p_payment_method, 'bank_transfer'), p_reference, p_notes, auth.uid()
  );

  -- Determine new status
  if v_new_amount_paid >= v_bill.total then
    v_new_status := 'paid';
    v_new_amount_paid := v_bill.total;
  else
    v_new_status := 'partially_paid';
  end if;

  update public.restaurant_bills
  set amount_paid = v_new_amount_paid, status = v_new_status, updated_at = now()
  where id = p_bill_id;

  return jsonb_build_object('success', true, 'id', v_payment_id);
end;
$$;

-- ── get_bill_payments ─────────────────────────────────────────
create or replace function public.get_bill_payments(
  p_bill_id uuid,
  p_lodge_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  perform public.app_require_feature(p_lodge_id, 'restaurant_accounting', ARRAY['admin', 'super_admin', 'manager', 'finance']);

  select jsonb_agg(
    jsonb_build_object(
      'id', bp.id,
      'bill_id', bp.bill_id,
      'payment_date', bp.payment_date,
      'amount', bp.amount,
      'payment_method', bp.payment_method,
      'reference', bp.reference,
      'notes', bp.notes,
      'created_by', bp.created_by,
      'created_at', bp.created_at
    )
  ) into v_result
  from public.restaurant_bill_payments bp
  where bp.bill_id = p_bill_id and bp.lodge_id = p_lodge_id
  order by bp.payment_date desc, bp.created_at desc;

  return coalesce(v_result, '[]'::jsonb);
end;
$$;

-- ── get_ap_aging ──────────────────────────────────────────────
create or replace function public.get_ap_aging(
  p_lodge_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  perform public.app_require_feature(p_lodge_id, 'restaurant_accounting', ARRAY['admin', 'super_admin', 'manager', 'finance']);

  select jsonb_build_object(
    'current', coalesce(sum(case when current_date <= due_date then outstanding else 0 end), 0),
    'days_1_30', coalesce(sum(case when current_date > due_date and current_date - due_date <= 30 then outstanding else 0 end), 0),
    'days_31_60', coalesce(sum(case when current_date - due_date between 31 and 60 then outstanding else 0 end), 0),
    'days_61_90', coalesce(sum(case when current_date - due_date between 61 and 90 then outstanding else 0 end), 0),
    'days_90_plus', coalesce(sum(case when current_date - due_date > 90 then outstanding else 0 end), 0),
    'bills', coalesce(jsonb_agg(
      jsonb_build_object(
        'id', b.id,
        'supplier_name', b.supplier_name,
        'bill_number', b.bill_number,
        'bill_date', b.bill_date,
        'due_date', b.due_date,
        'total', b.total,
        'amount_paid', b.amount_paid,
        'outstanding', b.total - b.amount_paid,
        'status', b.status,
        'days_overdue', case when current_date > b.due_date then current_date - b.due_date else 0 end
      )
      order by b.due_date asc
    ), '[]'::jsonb)
  ) into v_result
  from public.restaurant_bills b
  cross join lateral (select b.total - b.amount_paid as outstanding) o
  where b.lodge_id = p_lodge_id
    and b.status not in ('paid', 'cancelled')
    and b.total - b.amount_paid > 0;

  return coalesce(v_result, jsonb_build_object(
    'current', 0, 'days_1_30', 0, 'days_31_60', 0,
    'days_61_90', 0, 'days_90_plus', 0, 'bills', '[]'::jsonb
  ));
end;
$$;

-- ── get_ap_summary ────────────────────────────────────────────
create or replace function public.get_ap_summary(
  p_lodge_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  perform public.app_require_feature(p_lodge_id, 'restaurant_accounting', ARRAY['admin', 'super_admin', 'manager', 'finance']);

  select jsonb_build_object(
    'total_outstanding', coalesce(sum(total - amount_paid), 0),
    'total_overdue', coalesce(sum(case when status in ('overdue','partially_paid') and due_date < current_date then total - amount_paid else 0 end), 0),
    'total_due_this_month', coalesce(sum(case when due_date >= date_trunc('month', current_date) and due_date < date_trunc('month', current_date) + interval '1 month' then total - amount_paid else 0 end), 0),
    'bills_draft', count(*) filter (where status = 'draft'),
    'bills_submitted', count(*) filter (where status = 'submitted'),
    'bills_approved', count(*) filter (where status = 'approved'),
    'bills_partially_paid', count(*) filter (where status = 'partially_paid'),
    'bills_paid', count(*) filter (where status = 'paid'),
    'bills_overdue', count(*) filter (where status = 'overdue'),
    'bills_cancelled', count(*) filter (where status = 'cancelled'),
    'total_bills', count(*)
  ) into v_result
  from public.restaurant_bills
  where lodge_id = p_lodge_id;

  return coalesce(v_result, jsonb_build_object(
    'total_outstanding', 0, 'total_overdue', 0, 'total_due_this_month', 0,
    'bills_draft', 0, 'bills_submitted', 0, 'bills_approved', 0,
    'bills_partially_paid', 0, 'bills_paid', 0, 'bills_overdue', 0,
    'bills_cancelled', 0, 'total_bills', 0
  ));
end;
$$;

commit;
