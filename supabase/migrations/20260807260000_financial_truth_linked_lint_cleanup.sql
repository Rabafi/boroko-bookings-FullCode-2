-- Financial-truth linked-schema lint cleanup.
--
-- This migration is forward-only. It repairs active Manage/read projections
-- against the deployed schema and retires stale pre-V2 financial RPC bodies
-- without restoring their operator grants.

begin;

-- The asset registry migration owns this field, but some linked environments
-- predate it. Keep the existing asset UI contract stable before replacing the
-- sellability RPC below.
alter table public.property_assets add column if not exists notes text;

create or replace function public.get_asset_cost_summary(
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
  v_result jsonb;
begin
  perform public.app_require_feature(p_lodge_id, 'asset_management', array['manager', 'admin', 'super_admin', 'operations']);
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'cost_type', x.cost_type,
      'total_amount', x.total_amount,
      'count', x.cost_count
    ) order by x.cost_type
  ), '[]'::jsonb)
  into v_result
  from (
    select c.cost_type, sum(c.amount) as total_amount, count(c.id) as cost_count
    from public.asset_cost_tracking c
    where c.lodge_id = p_lodge_id
      and (p_start_date is null or c.cost_date >= p_start_date)
      and (p_end_date is null or c.cost_date <= p_end_date)
    group by c.cost_type
  ) x;
  return v_result;
end;
$$;

create or replace function public.get_asset_dashboard(p_lodge_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  perform public.app_require_feature(p_lodge_id, 'asset_management', array['manager', 'admin', 'super_admin', 'operations']);
  select jsonb_build_object(
    'total_assets', (select count(*) from public.property_assets where lodge_id = p_lodge_id and status = 'active'),
    'active_warranties', (select count(*) from public.asset_warranties where lodge_id = p_lodge_id and (end_date is null or end_date >= current_date)),
    'upcoming_inspections', (select count(*) from public.asset_inspections where lodge_id = p_lodge_id and next_inspection_date is not null and next_inspection_date between current_date and current_date + 30),
    'overdue_preventive', (select count(*) from public.preventive_schedule_assignments where lodge_id = p_lodge_id and status in ('pending', 'overdue') and next_due_date is not null and next_due_date < current_date),
    'total_cost_ytd', coalesce((select sum(amount) from public.asset_cost_tracking where lodge_id = p_lodge_id and cost_date >= date_trunc('year', current_date)), 0),
    'assets_by_category', coalesce((
      select jsonb_agg(jsonb_build_object('category', x.category, 'count', x.asset_count) order by x.asset_count desc, x.category)
      from (
        select coalesce(a.category, 'Uncategorized') as category, count(*) as asset_count
        from public.property_assets a
        where a.lodge_id = p_lodge_id and a.status = 'active'
        group by coalesce(a.category, 'Uncategorized')
      ) x
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

create or replace function public.set_asset_room_sellability(
  p_lodge_id uuid,
  p_asset_id uuid,
  p_affects_sellability boolean,
  p_sellability_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_id uuid;
begin
  perform public.app_require_feature(p_lodge_id, 'asset_management', array['manager', 'admin', 'super_admin']);
  select room_id into v_room_id
  from public.property_assets
  where id = p_asset_id and lodge_id = p_lodge_id;
  if v_room_id is null then
    return jsonb_build_object('success', false, 'error', 'Asset not found or has no room assignment');
  end if;

  update public.property_assets
  set notes = case when p_affects_sellability then
      coalesce(notes, '') || E'\n[Sellability] ' || coalesce(p_sellability_notes, 'Affects room sellability')
    else notes end,
    updated_at = now()
  where id = p_asset_id and lodge_id = p_lodge_id;

  if p_affects_sellability then
    update public.rooms
    set status = 'maintenance',
        housekeeping_notes = coalesce(housekeeping_notes, '') || E'\nAsset sellability: ' || coalesce(p_sellability_notes, 'Asset affects sellability'),
        updated_at = now()
    where id = v_room_id and lodge_id = p_lodge_id;
  end if;
  return jsonb_build_object('success', true, 'room_id', v_room_id, 'affects_sellability', p_affects_sellability);
end;
$$;

-- auth.users exposes email and metadata, not a name column. Keep the
-- operator-facing names while remaining compatible with the auth-owned FKs.
create or replace function public.get_task_assignments(
  p_lodge_id uuid,
  p_staff_id uuid default null,
  p_status text default null,
  p_date date default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_result jsonb;
begin
  perform public.app_require_feature(p_lodge_id, 'workforce_management', array['manager', 'admin', 'super_admin', 'receptionist', 'operations']);
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', ta.id,
    'staff_id', ta.staff_id,
    'staff_name', coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', u.email, 'Unknown'),
    'task_category_id', ta.task_category_id,
    'category_name', tc.name,
    'category_color', tc.color,
    'title', ta.title,
    'description', ta.description,
    'priority', ta.priority,
    'status', ta.status,
    'due_date', ta.due_date,
    'assigned_by', ta.assigned_by,
    'assigned_by_name', coalesce(au.raw_user_meta_data->>'full_name', au.raw_user_meta_data->>'name', au.email, 'Unknown'),
    'completed_at', ta.completed_at,
    'completed_notes', ta.completed_notes,
    'created_at', ta.created_at,
    'updated_at', ta.updated_at
  ) order by ta.created_at desc), '[]'::jsonb)
  into v_result
  from public.staff_task_assignments ta
  left join auth.users u on u.id = ta.staff_id
  left join auth.users au on au.id = ta.assigned_by
  left join public.staff_task_categories tc on tc.id = ta.task_category_id
  where ta.lodge_id = p_lodge_id
    and (p_staff_id is null or ta.staff_id = p_staff_id)
    and (p_status is null or ta.status = p_status)
    and (p_date is null or ta.due_date = p_date);
  return v_result;
end;
$$;

create or replace function public.get_training_records(p_lodge_id uuid, p_staff_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_result jsonb;
begin
  perform public.app_require_feature(p_lodge_id, 'workforce_management', array['manager', 'admin', 'super_admin', 'receptionist', 'operations']);
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id,
    'staff_id', r.staff_id,
    'staff_name', coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', u.email, 'Unknown'),
    'checklist_id', r.checklist_id,
    'checklist_title', c.title,
    'completed_at', r.completed_at,
    'completed_by', r.completed_by,
    'completed_by_name', coalesce(au.raw_user_meta_data->>'full_name', au.raw_user_meta_data->>'name', au.email, 'Unknown'),
    'notes', r.notes
  ) order by r.completed_at desc), '[]'::jsonb)
  into v_result
  from public.staff_training_records r
  left join auth.users u on u.id = r.staff_id
  left join auth.users au on au.id = r.completed_by
  left join public.staff_training_checklists c on c.id = r.checklist_id
  where r.lodge_id = p_lodge_id
    and (p_staff_id is null or r.staff_id = p_staff_id);
  return v_result;
end;
$$;

create or replace function public.get_shift_handovers(p_lodge_id uuid, p_date date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_result jsonb;
begin
  perform public.app_require_feature(p_lodge_id, 'workforce_management', array['manager', 'admin', 'super_admin', 'receptionist', 'operations']);
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', h.id,
    'from_staff_id', h.from_staff_id,
    'from_staff_name', coalesce(fu.raw_user_meta_data->>'full_name', fu.raw_user_meta_data->>'name', fu.email, 'Unknown'),
    'to_staff_id', h.to_staff_id,
    'to_staff_name', coalesce(tu.raw_user_meta_data->>'full_name', tu.raw_user_meta_data->>'name', tu.email, 'Unknown'),
    'shift_date', h.shift_date,
    'notes', h.notes,
    'pending_tasks', h.pending_tasks,
    'completed_at', h.completed_at,
    'created_at', h.created_at
  ) order by h.created_at desc), '[]'::jsonb)
  into v_result
  from public.staff_handover_logs h
  left join auth.users fu on fu.id = h.from_staff_id
  left join auth.users tu on tu.id = h.to_staff_id
  where h.lodge_id = p_lodge_id
    and (p_date is null or h.shift_date = p_date);
  return v_result;
end;
$$;

create or replace function public.get_staff_productivity_dashboard(p_lodge_id uuid, p_start_date date, p_end_date date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_metrics jsonb; v_summary jsonb;
begin
  perform public.app_require_feature(p_lodge_id, 'workforce_management', array['manager', 'admin', 'super_admin', 'receptionist', 'operations']);
  select coalesce(jsonb_agg(jsonb_build_object(
    'staff_id', pm.staff_id,
    'staff_name', coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', u.email, 'Unknown'),
    'metric_date', pm.metric_date,
    'tasks_completed', pm.tasks_completed,
    'tasks_on_time', pm.tasks_on_time,
    'avg_completion_time_minutes', pm.avg_completion_time_minutes,
    'incidents', pm.incidents,
    'rating', pm.rating
  ) order by pm.metric_date, coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', u.email)), '[]'::jsonb)
  into v_metrics
  from public.staff_productivity_metrics pm
  left join auth.users u on u.id = pm.staff_id
  where pm.lodge_id = p_lodge_id and pm.metric_date between p_start_date and p_end_date;

  select jsonb_build_object(
    'total_tasks', coalesce(sum(pm.tasks_completed), 0),
    'on_time_tasks', coalesce(sum(pm.tasks_on_time), 0),
    'total_incidents', coalesce(sum(pm.incidents), 0),
    'avg_rating', round(coalesce(avg(pm.rating), 0), 1),
    'staff_count', count(distinct pm.staff_id)
  ) into v_summary
  from public.staff_productivity_metrics pm
  where pm.lodge_id = p_lodge_id and pm.metric_date between p_start_date and p_end_date;
  return jsonb_build_object('metrics', v_metrics, 'summary', coalesce(v_summary, '{}'::jsonb));
end;
$$;

create or replace function public.get_schedule_conflicts(p_lodge_id uuid, p_week_start date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_week_end date := p_week_start + 6; v_conflicts jsonb;
begin
  perform public.app_require_feature(p_lodge_id, 'workforce_management', array['manager', 'admin', 'super_admin', 'receptionist', 'operations']);
  select coalesce(jsonb_agg(jsonb_build_object(
    'staff_id', a.staff_id,
    'staff_name', coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', u.email, 'Unknown'),
    'schedule_date', a.schedule_date,
    'shift_a_id', a.id,
    'shift_a_label', a.shift_label,
    'shift_a_start', a.start_time,
    'shift_a_end', a.end_time,
    'shift_b_id', b.id,
    'shift_b_label', b.shift_label,
    'shift_b_start', b.start_time,
    'shift_b_end', b.end_time
  )), '[]'::jsonb) into v_conflicts
  from public.staff_schedules a
  join public.staff_schedules b on b.staff_id = a.staff_id
    and b.schedule_date = a.schedule_date
    and b.id < a.id
    and tsrange(a.schedule_date + a.start_time, a.schedule_date + a.end_time, '[]')
      && tsrange(b.schedule_date + b.start_time, b.schedule_date + b.end_time, '[]')
  left join auth.users u on u.id = a.staff_id
  where a.lodge_id = p_lodge_id
    and b.lodge_id = p_lodge_id
    and a.schedule_date between p_week_start and v_week_end
    and a.shift_label <> 'off' and b.shift_label <> 'off';
  return jsonb_build_object('has_conflicts', jsonb_array_length(v_conflicts) > 0, 'conflicts', v_conflicts);
end;
$$;

-- The bank workspace is active. The proposal table uses proposed_at, not
-- created_at; retain the source row in the projection without leaking raw
-- statement payloads.
create or replace function public.get_restaurant_bank_workspace_v2(p_lodge_id uuid, p_bank_account_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public._restaurant_require_capability(p_lodge_id, 'accounting.read');
  if p_bank_account_id is not null and not exists(
    select 1 from public.restaurant_bank_accounts where id = p_bank_account_id and lodge_id = p_lodge_id
  ) then
    raise exception 'Bank account belongs to another lodge or is missing' using errcode = '23503';
  end if;
  return jsonb_build_object('success', true, 'data', jsonb_build_object(
    'accounts', coalesce((select jsonb_agg(to_jsonb(a) || jsonb_build_object(
      'ledger_balance', coalesce((select round(sum(l.debit - l.credit), 2)
        from public.restaurant_journal_lines l
        join public.restaurant_journal_entries e on e.id = l.entry_id
        where l.account_id = a.account_id and e.lodge_id = p_lodge_id and e.is_posted), 0)
    ) order by a.name) from public.restaurant_bank_accounts a where a.lodge_id = p_lodge_id), '[]'::jsonb),
    'imports', coalesce((select jsonb_agg(to_jsonb(i) - 'raw_payload' order by i.period_end desc, i.imported_at desc)
      from public.restaurant_bank_statement_imports i
      where i.lodge_id = p_lodge_id and (p_bank_account_id is null or i.bank_account_id = p_bank_account_id)), '[]'::jsonb),
    'transactions', coalesce((select jsonb_agg(to_jsonb(t) || jsonb_build_object(
      'proposal', coalesce((select to_jsonb(p) from public.restaurant_match_proposals p
        where p.bank_transaction_id = t.id order by p.proposed_at desc limit 1), 'null'::jsonb)
    ) order by t.transaction_date desc, t.imported_at desc)
      from public.restaurant_bank_transactions t
      where t.lodge_id = p_lodge_id and (p_bank_account_id is null or t.bank_account_id = p_bank_account_id)), '[]'::jsonb),
    'reconciliations', coalesce((select jsonb_agg(to_jsonb(r) order by r.reconciliation_date desc, r.created_at desc)
      from public.restaurant_bank_reconciliations r
      where r.lodge_id = p_lodge_id and (p_bank_account_id is null or r.bank_account_id = p_bank_account_id)), '[]'::jsonb)
  ));
end;
$$;

-- Repair the retired AP compatibility reads/writes so database lint remains
-- truthful even though operator access remains denied and V2 is authoritative.
create or replace function public.get_restaurant_bills(
  p_lodge_id uuid, p_status text default null, p_start_date date default null, p_end_date date default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_result jsonb;
begin
  perform public.app_require_feature(p_lodge_id, 'restaurant_accounting', array['admin', 'super_admin', 'manager', 'finance']);
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', b.id, 'supplier_id', b.supplier_id, 'supplier_name', b.supplier_name,
    'bill_number', b.bill_number, 'bill_date', b.bill_date, 'due_date', b.due_date,
    'subtotal', b.subtotal, 'tax_amount', b.tax_amount, 'total', b.total,
    'amount_paid', b.amount_paid, 'status', b.status, 'notes', b.notes,
    'created_by', b.created_by, 'created_at', b.created_at, 'updated_at', b.updated_at,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
      'id', bi.id, 'description', bi.description, 'quantity', bi.quantity,
      'unit_cost', bi.unit_cost, 'total', bi.total, 'inventory_item_id', bi.inventory_item_id,
      'category', bi.category
    ) order by bi.id) from public.restaurant_bill_items bi where bi.bill_id = b.id), '[]'::jsonb)
  ) order by b.bill_date desc, b.created_at desc), '[]'::jsonb)
  into v_result
  from public.restaurant_bills b
  where b.lodge_id = p_lodge_id
    and (p_status is null or b.status = p_status)
    and (p_start_date is null or b.bill_date >= p_start_date)
    and (p_end_date is null or b.bill_date <= p_end_date);
  return v_result;
end;
$$;

create or replace function public.create_restaurant_bill(
  p_lodge_id uuid, p_supplier_id uuid, p_supplier_name text, p_bill_number text,
  p_bill_date date, p_due_date date, p_notes text, p_items jsonb
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_bill_id uuid; v_subtotal numeric := 0; v_tax numeric := 0; v_total numeric := 0; v_item jsonb; v_item_total numeric;
begin
  perform public.app_require_feature(p_lodge_id, 'restaurant_accounting', array['admin', 'super_admin', 'manager', 'finance']);
  if p_items is null or jsonb_array_length(p_items) = 0 then return jsonb_build_object('success', false, 'error', 'At least one bill item is required'); end if;
  if p_due_date < p_bill_date then return jsonb_build_object('success', false, 'error', 'Due date cannot be before bill date'); end if;
  v_bill_id := gen_random_uuid();
  for v_item in select value from jsonb_array_elements(p_items) as items(value) loop
    v_item_total := coalesce((v_item->>'total')::numeric, 0);
    v_subtotal := v_subtotal + v_item_total;
  end loop;
  v_total := v_subtotal + v_tax;
  insert into public.restaurant_bills(id, lodge_id, supplier_id, supplier_name, bill_number, bill_date, due_date, subtotal, tax_amount, total, amount_paid, status, notes, created_by)
  values(v_bill_id, p_lodge_id, p_supplier_id, p_supplier_name, p_bill_number, p_bill_date, p_due_date, v_subtotal, v_tax, v_total, 0, 'draft', p_notes, auth.uid());
  insert into public.restaurant_bill_items(id, bill_id, lodge_id, description, quantity, unit_cost, total, inventory_item_id, category)
  select coalesce((items.value->>'id')::uuid, gen_random_uuid()), v_bill_id, p_lodge_id,
    items.value->>'description', coalesce((items.value->>'quantity')::numeric, 1),
    coalesce((items.value->>'unit_cost')::numeric, 0), coalesce((items.value->>'total')::numeric, 0),
    (items.value->>'inventory_item_id')::uuid, items.value->>'category'
  from jsonb_array_elements(p_items) as items(value);
  return jsonb_build_object('success', true, 'id', v_bill_id);
end;
$$;

create or replace function public.update_bill_items(p_bill_id uuid, p_lodge_id uuid, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_subtotal numeric := 0; v_total numeric; v_bill record;
begin
  perform public.app_require_feature(p_lodge_id, 'restaurant_accounting', array['admin', 'super_admin', 'manager', 'finance']);
  select * into v_bill from public.restaurant_bills where id = p_bill_id and lodge_id = p_lodge_id;
  if not found then return jsonb_build_object('success', false, 'error', 'Bill not found'); end if;
  if v_bill.status not in ('draft', 'submitted') then return jsonb_build_object('success', false, 'error', 'Cannot edit items for a bill in ' || v_bill.status || ' status'); end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then return jsonb_build_object('success', false, 'error', 'At least one bill item is required'); end if;
  delete from public.restaurant_bill_items where bill_id = p_bill_id;
  insert into public.restaurant_bill_items(id, bill_id, lodge_id, description, quantity, unit_cost, total, inventory_item_id, category)
  select coalesce((items.value->>'id')::uuid, gen_random_uuid()), p_bill_id, p_lodge_id,
    items.value->>'description', coalesce((items.value->>'quantity')::numeric, 1),
    coalesce((items.value->>'unit_cost')::numeric, 0), coalesce((items.value->>'total')::numeric, 0),
    (items.value->>'inventory_item_id')::uuid, items.value->>'category'
  from jsonb_array_elements(p_items) as items(value);
  select coalesce(sum(total), 0) into v_subtotal from public.restaurant_bill_items where bill_id = p_bill_id;
  v_total := v_subtotal + v_bill.tax_amount;
  update public.restaurant_bills set subtotal = v_subtotal, total = v_total, updated_at = now() where id = p_bill_id;
  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.get_bill_payments(p_bill_id uuid, p_lodge_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_result jsonb;
begin
  perform public.app_require_feature(p_lodge_id, 'restaurant_accounting', array['admin', 'super_admin', 'manager', 'finance']);
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', bp.id, 'bill_id', bp.bill_id, 'payment_date', bp.payment_date, 'amount', bp.amount,
    'payment_method', bp.payment_method, 'reference', bp.reference, 'notes', bp.notes,
    'created_by', bp.created_by, 'created_at', bp.created_at
  ) order by bp.payment_date desc, bp.created_at desc), '[]'::jsonb)
  into v_result
  from public.restaurant_bill_payments bp
  where bp.bill_id = p_bill_id and bp.lodge_id = p_lodge_id;
  return v_result;
end;
$$;

-- Preserve concurrency locking for the corporate-payment compatibility RPC.
create or replace function public.record_corporate_payment(
  p_account_id uuid, p_lodge_id uuid, p_invoice_ids uuid[], p_amount numeric,
  p_payment_method text default 'bank_transfer', p_reference text default '', p_idempotency_key text default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_payment_id uuid; v_invoice_id uuid; v_invoice record; v_remaining numeric; v_allocated numeric := 0;
  v_payment_ids uuid[] := '{}'; v_allocation_details jsonb := '[]'::jsonb;
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), ''); v_claim jsonb; v_result jsonb; v_hash text; v_distinct_count int; v_this_allocation numeric;
begin
  perform public.app_require_feature(p_lodge_id, 'corporate_accounts', array['manager', 'admin', 'super_admin', 'finance']);
  if v_key is null or length(v_key) < 8 or length(v_key) > 128 then return jsonb_build_object('success', false, 'error', 'Idempotency key must be between 8 and 128 characters'); end if;
  v_hash := encode(sha256((coalesce(p_account_id::text, '') || '|' || coalesce(p_amount::text, '') || '|' || coalesce(p_payment_method, '') || '|' || coalesce(p_reference, '') || '|' || array_to_string((select array_agg(i order by i) from unnest(p_invoice_ids) i), ','))::bytea), 'hex');
  v_claim := public._claim_financial_operation(p_lodge_id, v_key, 'record_corporate_payment', p_account_id, v_hash);
  if (v_claim->>'success')::boolean is not true then return v_claim; end if;
  if (v_claim->>'found')::boolean = true then return coalesce(v_claim->'operation_result', v_claim); end if;
  if p_amount <= 0 then return jsonb_build_object('success', false, 'error', 'Payment amount must be positive'); end if;
  if p_invoice_ids is null or array_length(p_invoice_ids, 1) is null or array_length(p_invoice_ids, 1) = 0 then return jsonb_build_object('success', false, 'error', 'At least one invoice must be specified'); end if;
  select count(*) into v_distinct_count from (select distinct unnest(p_invoice_ids) d) x;
  if v_distinct_count <> array_length(p_invoice_ids, 1) then return jsonb_build_object('success', false, 'error', 'Duplicate invoice IDs are not allowed'); end if;

  for v_invoice in
    select i.id, i.amount, i.lodge_id, i.corporate_account_id,
      coalesce((select sum(cp.amount) from public.corporate_payments cp where cp.invoice_id = i.id), 0) as paid_so_far
    from public.corporate_invoice_items i
    where i.id = any(p_invoice_ids) and i.corporate_account_id = p_account_id and i.lodge_id = p_lodge_id
    order by i.id
    for update of i
  loop
    v_remaining := v_invoice.amount - v_invoice.paid_so_far;
    if v_remaining <= 0 then continue; end if;
    v_payment_id := gen_random_uuid();
    v_this_allocation := least(v_remaining, p_amount - v_allocated);
    insert into public.corporate_payments(id, corporate_account_id, lodge_id, invoice_id, amount, payment_date, payment_method, reference)
    values(v_payment_id, p_account_id, p_lodge_id, v_invoice.id, v_this_allocation, current_date, p_payment_method, p_reference);
    v_allocated := v_allocated + v_this_allocation;
    v_payment_ids := array_append(v_payment_ids, v_payment_id);
    v_allocation_details := v_allocation_details || jsonb_build_object('invoice_id', v_invoice.id, 'payment_id', v_payment_id, 'allocated', v_this_allocation);
    exit when v_allocated >= p_amount;
  end loop;
  if v_allocated < p_amount then raise exception 'Payment allocation incomplete: allocated % of % — some invoices not found or fully paid', v_allocated, p_amount; end if;
  for v_invoice_id in select distinct unnest(p_invoice_ids) loop
    update public.corporate_invoice_items i set
      status = case when (select coalesce(sum(cp3.amount), 0) from public.corporate_payments cp3 where cp3.invoice_id = i.id) >= i.amount then 'paid' else i.status end,
      paid_date = case when (select coalesce(sum(cp3.amount), 0) from public.corporate_payments cp3 where cp3.invoice_id = i.id) >= i.amount then current_date else paid_date end,
      updated_at = now()
    where i.id = v_invoice_id and i.lodge_id = p_lodge_id;
  end loop;
  v_result := jsonb_build_object('success', true, 'payment_ids', v_payment_ids, 'allocated', v_allocated, 'allocation', v_allocation_details);
  perform public._record_financial_operation(p_lodge_id, v_key, 'record_corporate_payment', p_account_id, v_hash, v_result);
  return v_result;
end;
$$;

-- These compatibility RPCs were intentionally shut down by the V2 rebuild.
-- Keep their signatures for old clients, but do not leave stale SQL bodies
-- that can be called by service-role maintenance or fail database lint.
create or replace function public.post_pos_sales_to_gl(p_lodge_id uuid, p_start_date date, p_end_date date)
returns jsonb language plpgsql security definer set search_path = public as $$
begin return jsonb_build_object('success', false, 'error', 'Legacy POS posting retired; use post_pos_order_to_gl_v2'); end; $$;

create or replace function public.auto_match_transactions(p_lodge_id uuid, p_bank_account_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin return jsonb_build_object('success', false, 'error', 'Legacy bank matching retired; use propose_bank_matches_v2'); end; $$;

create or replace function public.propose_bank_matches(p_lodge_id uuid, p_bank_account_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin return jsonb_build_object('success', false, 'error', 'Legacy bank matching retired; use propose_bank_matches_v2'); end; $$;

create or replace function public.calculate_payroll(p_pay_period_id uuid, p_lodge_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin return jsonb_build_object('success', false, 'error', 'Legacy payroll calculation retired; use calculate_restaurant_payroll_v2'); end; $$;

create or replace function public.get_tax_return_summary(p_lodge_id uuid, p_period_start date, p_period_end date)
returns jsonb language plpgsql security definer set search_path = public as $$
begin return jsonb_build_object('success', false, 'error', 'Legacy tax summary retired; use get_restaurant_tax_working_papers_v2'); end; $$;

create or replace function public.get_restaurant_cash_flow_statement(p_lodge_id uuid, p_start_date date, p_end_date date)
returns jsonb language plpgsql security definer set search_path = public as $$
begin return jsonb_build_object('success', false, 'error', 'Legacy cash-flow statement retired; use get_restaurant_financial_statements_v2'); end; $$;

commit;
