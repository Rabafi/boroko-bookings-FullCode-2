begin;

-- ============================================================
-- Restaurant Tax Returns (VAT/GST)
-- Gated to restaurant-bar only — no hotel/lodge impact
-- ============================================================

-- ── Tax Returns Table ────────────────────────────────────────
create table if not exists public.restaurant_tax_returns (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  period_start date not null,
  period_end date not null,
  tax_rate numeric(5,2) not null default 14,
  total_sales_incl numeric(15,2) not null default 0,
  total_sales_excl numeric(15,2) not null default 0,
  total_tax_collected numeric(15,2) not null default 0,
  total_purchases_incl numeric(15,2) not null default 0,
  total_purchases_excl numeric(15,2) not null default 0,
  total_input_tax numeric(15,2) not null default 0,
  net_tax_payable numeric(15,2) not null default 0,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'filed')),
  filed_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.restaurant_tax_returns enable row level security;

create policy restaurant_tax_returns_lodge_scope_select on public.restaurant_tax_returns
  for select using (public.app_lodge_access(lodge_id));

create policy restaurant_tax_returns_lodge_scope_insert on public.restaurant_tax_returns
  for insert with check (public.app_lodge_access(lodge_id));

create policy restaurant_tax_returns_lodge_scope_update on public.restaurant_tax_returns
  for update using (public.app_lodge_access(lodge_id));

create policy restaurant_tax_returns_lodge_scope_delete on public.restaurant_tax_returns
  for delete using (public.app_lodge_access(lodge_id));

create unique index if not exists restaurant_tax_returns_lodge_period_uidx
  on public.restaurant_tax_returns (lodge_id, period_start, period_end);

-- ── RPC: generate_tax_return ─────────────────────────────────
create or replace function public.generate_tax_return(
  p_lodge_id uuid,
  p_period_start date,
  p_period_end date,
  p_tax_rate numeric default 14
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_existing_status text;
  v_sales_rec record;
  v_purchase_rec record;
  v_total_sales_incl numeric := 0;
  v_total_sales_excl numeric := 0;
  v_total_tax_collected numeric := 0;
  v_total_purchases_incl numeric := 0;
  v_total_purchases_excl numeric := 0;
  v_total_input_tax numeric := 0;
  v_net_tax_payable numeric := 0;
  v_result jsonb;
begin
  perform public.app_require_feature(p_lodge_id, 'restaurant_accounting', array['finance', 'manager', 'admin', 'super_admin']);

  -- Skip if already submitted or filed
  select status into v_existing_status
    from public.restaurant_tax_returns
   where lodge_id = p_lodge_id
     and period_start = p_period_start
     and period_end = p_period_end;

  if v_existing_status in ('submitted', 'filed') then
    return jsonb_build_object(
      'success', false,
      'error', 'Cannot regenerate a ' || v_existing_status || ' tax return'
    );
  end if;

  -- Aggregate sales from pos_orders (exclude voids and returns)
  select
    coalesce(sum(tax_total), 0) as tax_collected,
    coalesce(sum(
      case when gross_total > 0
        then greatest(gross_total - discount_total, 0)
        else 0
      end
    ), 0) as sales_excl,
    coalesce(sum(
      case when gross_total > 0
        then greatest(gross_total - discount_total, 0) + tax_total
        else 0
      end
    ), 0) as sales_incl
  into v_sales_rec
  from public.pos_orders
  where lodge_id = p_lodge_id
    and coalesce(status, 'open') not in ('voided', 'cancelled')
    and coalesce(transaction_type, 'sale') != 'return'
    and created_at::date >= p_period_start
    and created_at::date <= p_period_end;

  v_total_tax_collected := coalesce(v_sales_rec.tax_collected, 0);
  v_total_sales_excl := coalesce(v_sales_rec.sales_excl, 0);
  v_total_sales_incl := coalesce(v_sales_rec.sales_incl, 0);

  -- Aggregate purchases from expenses
  -- Derive tax from amount: tax = amount * tax_rate / (100 + tax_rate)
  select
    coalesce(sum(amount), 0) as total_amount,
    coalesce(sum(round(amount * p_tax_rate / (100 + p_tax_rate), 2)), 0) as input_tax,
    coalesce(sum(amount - round(amount * p_tax_rate / (100 + p_tax_rate), 2)), 0) as purchases_excl
  into v_purchase_rec
  from public.expenses
  where lodge_id = p_lodge_id
    and date >= p_period_start
    and date <= p_period_end;

  v_total_purchases_incl := coalesce(v_purchase_rec.total_amount, 0);
  v_total_input_tax := coalesce(v_purchase_rec.input_tax, 0);
  v_total_purchases_excl := coalesce(v_purchase_rec.purchases_excl, 0);

  v_net_tax_payable := round(v_total_tax_collected - v_total_input_tax, 2);

  -- Upsert the tax return
  insert into public.restaurant_tax_returns (
    lodge_id, period_start, period_end, tax_rate,
    total_sales_incl, total_sales_excl, total_tax_collected,
    total_purchases_incl, total_purchases_excl, total_input_tax,
    net_tax_payable, status, updated_at
  ) values (
    p_lodge_id, p_period_start, p_period_end, p_tax_rate,
    v_total_sales_incl, v_total_sales_excl, v_total_tax_collected,
    v_total_purchases_incl, v_total_purchases_excl, v_total_input_tax,
    v_net_tax_payable, 'draft', now()
  )
  on conflict (lodge_id, period_start, period_end) do update set
    tax_rate = excluded.tax_rate,
    total_sales_incl = excluded.total_sales_incl,
    total_sales_excl = excluded.total_sales_excl,
    total_tax_collected = excluded.total_tax_collected,
    total_purchases_incl = excluded.total_purchases_incl,
    total_purchases_excl = excluded.total_purchases_excl,
    total_input_tax = excluded.total_input_tax,
    net_tax_payable = excluded.net_tax_payable,
    status = 'draft',
    filed_at = null,
    updated_at = now();

  select row_to_json(tr) into v_result
    from public.restaurant_tax_returns tr
   where tr.lodge_id = p_lodge_id
     and tr.period_start = p_period_start
     and tr.period_end = p_period_end;

  return jsonb_build_object('success', true, 'tax_return', v_result);
end;
$$;

grant execute on function public.generate_tax_return(uuid, date, date, numeric) to anon, authenticated;

-- ── RPC: get_restaurant_tax_returns ──────────────────────────
create or replace function public.get_restaurant_tax_returns(
  p_lodge_id uuid
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_returns jsonb;
begin
  perform public.app_require_feature(p_lodge_id, 'restaurant_accounting', array['finance', 'manager', 'admin', 'super_admin']);

  select coalesce(jsonb_agg(row_to_json(tr) order by tr.period_start desc), '[]'::jsonb)
    into v_returns
  from public.restaurant_tax_returns tr
  where tr.lodge_id = p_lodge_id;

  return jsonb_build_object('success', true, 'tax_returns', v_returns);
end;
$$;

grant execute on function public.get_restaurant_tax_returns(uuid) to anon, authenticated;

-- ── RPC: update_tax_return ───────────────────────────────────
create or replace function public.update_tax_return(
  p_id uuid,
  p_lodge_id uuid,
  p_status text default null,
  p_notes text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_current record;
  v_valid_transitions text[][] := array[
    array['draft', 'submitted'],
    array['submitted', 'filed']
  ];
  v_transition_valid boolean := false;
  v_i integer;
begin
  perform public.app_require_feature(p_lodge_id, 'restaurant_accounting', array['finance', 'manager', 'admin', 'super_admin']);

  select * into v_current
    from public.restaurant_tax_returns
   where id = p_id and lodge_id = p_lodge_id;

  if v_current is null then
    return jsonb_build_object('success', false, 'error', 'Tax return not found');
  end if;

  -- Validate status transition if status is being changed
  if p_status is not null and p_status != v_current.status then
    for v_i in 1..array_length(v_valid_transitions, 1) loop
      if v_valid_transitions[v_i][1] = v_current.status
         and v_valid_transitions[v_i][2] = p_status then
        v_transition_valid := true;
        exit;
      end if;
    end loop;

    if not v_transition_valid then
      return jsonb_build_object(
        'success', false,
        'error', 'Cannot transition from ' || v_current.status || ' to ' || p_status
      );
    end if;
  end if;

  update public.restaurant_tax_returns
     set
       status = coalesce(p_status, status),
       notes = case when p_notes is not null then p_notes else notes end,
       filed_at = case when p_status = 'filed' then now() else filed_at end,
       updated_at = now()
   where id = p_id and lodge_id = p_lodge_id;

  return jsonb_build_object('success', true);
end;
$$;

grant execute on function public.update_tax_return(uuid, uuid, text, text) to anon, authenticated;

-- ── RPC: get_tax_return_summary ──────────────────────────────
create or replace function public.get_tax_return_summary(
  p_lodge_id uuid,
  p_period_start date,
  p_period_end date
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_tax_rate numeric;
  v_sales_summary jsonb;
  v_purchase_summary jsonb;
begin
  perform public.app_require_feature(p_lodge_id, 'restaurant_accounting', array['finance', 'manager', 'admin', 'super_admin']);

  select coalesce(tax_rate, 14) into v_tax_rate
    from public.settings
   where lodge_id = p_lodge_id
   limit 1;

  -- Sales breakdown by category (menu item category)
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'category', coalesce(cat.category, 'Uncategorised'),
      'total_excl', cat.total_excl,
      'tax_collected', cat.tax_collected,
      'total_incl', cat.total_incl
    )
  ), '[]'::jsonb)
  into v_sales_summary
  from (
    select
      coalesce(mi.category, 'Uncategorised') as category,
      sum(greatest(oi.gross_subtotal - oi.discount_allocated, 0)) as total_excl,
      sum(oi.tax_allocated) as tax_collected,
      sum(greatest(oi.gross_subtotal - oi.discount_allocated, 0) + oi.tax_allocated) as total_incl
    from public.pos_order_items oi
    join public.pos_orders o on o.id = oi.order_id
    left join public.pos_menu_items mi on mi.id = oi.menu_item_id
    where o.lodge_id = p_lodge_id
      and coalesce(o.status, 'open') not in ('voided', 'cancelled')
      and coalesce(o.transaction_type, 'sale') != 'return'
      and o.created_at::date >= p_period_start
      and o.created_at::date <= p_period_end
    group by coalesce(mi.category, 'Uncategorised')
    order by total_excl desc
  ) cat;

  -- Purchase breakdown by category
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'category', coalesce(pcat.category, 'Uncategorised'),
      'total_incl', pcat.total_incl,
      'input_tax', pcat.input_tax,
      'total_excl', pcat.total_excl
    )
  ), '[]'::jsonb)
  into v_purchase_summary
  from (
    select
      coalesce(category, 'Uncategorised') as category,
      sum(amount) as total_incl,
      sum(round(amount * v_tax_rate / (100 + v_tax_rate), 2)) as input_tax,
      sum(amount - round(amount * v_tax_rate / (100 + v_tax_rate), 2)) as total_excl
    from public.expenses
    where lodge_id = p_lodge_id
      and date >= p_period_start
      and date <= p_period_end
    group by category
    order by total_incl desc
  ) pcat;

  return jsonb_build_object(
    'success', true,
    'period_start', p_period_start,
    'period_end', p_period_end,
    'tax_rate', v_tax_rate,
    'sales_by_category', v_sales_summary,
    'purchases_by_category', v_purchase_summary
  );
end;
$$;

grant execute on function public.get_tax_return_summary(uuid, date, date) to anon, authenticated;

-- Notify PostgREST to reload schema
notify pgrst, 'reload schema';

commit;
