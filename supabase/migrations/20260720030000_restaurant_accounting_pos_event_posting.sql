-- Restaurant Accounting transaction-level POS posting rebuild.
-- No operator grants are restored by this migration.

begin;

create table if not exists public.restaurant_pos_gl_mappings (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  mapping_type text not null check (mapping_type in ('category', 'tender', 'discount', 'tax', 'tips')),
  source_key text not null,
  account_id uuid not null references public.restaurant_accounts(id) on delete restrict,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(lodge_id, mapping_type, source_key)
);

alter table public.restaurant_pos_gl_mappings enable row level security;
revoke all on table public.restaurant_pos_gl_mappings from public, anon, authenticated;
grant select, insert, update, delete on table public.restaurant_pos_gl_mappings to service_role;

create or replace function public.get_restaurant_pos_gl_mappings(p_lodge_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._restaurant_require_capability(p_lodge_id, 'accounting.read');
  return jsonb_build_object('success', true, 'data', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', m.id, 'mapping_type', m.mapping_type, 'source_key', m.source_key,
      'account_id', m.account_id, 'account_code', a.code, 'account_name', a.name
    ) order by m.mapping_type, m.source_key)
    from public.restaurant_pos_gl_mappings m
    join public.restaurant_accounts a on a.id = m.account_id and a.lodge_id = m.lodge_id
    where m.lodge_id = p_lodge_id
  ), '[]'::jsonb));
end;
$$;

create or replace function public.set_restaurant_pos_gl_mapping(
  p_lodge_id uuid,
  p_mapping_type text,
  p_source_key text,
  p_account_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_account_type text;
  v_id uuid;
begin
  v_actor := public._restaurant_require_capability(p_lodge_id, 'accounting.manage');
  if p_mapping_type not in ('category', 'tender', 'discount', 'tax', 'tips')
     or nullif(lower(btrim(p_source_key)), '') is null then
    raise exception 'Valid mapping type and source key are required' using errcode = '22023';
  end if;

  select account_type into v_account_type
  from public.restaurant_accounts
  where id = p_account_id and lodge_id = p_lodge_id and is_active;
  if not found then
    raise exception 'Mapped account is inactive, missing, or belongs to another lodge'
      using errcode = '23503';
  end if;
  if p_mapping_type in ('category', 'discount') and v_account_type <> 'revenue' then
    raise exception 'Category and discount mappings require revenue accounts' using errcode = '22023';
  end if;
  if p_mapping_type = 'tender' and v_account_type <> 'asset' then
    raise exception 'Tender mappings require asset accounts' using errcode = '22023';
  end if;
  if p_mapping_type in ('tax', 'tips') and v_account_type <> 'liability' then
    raise exception 'Tax and tips mappings require liability accounts' using errcode = '22023';
  end if;

  insert into public.restaurant_pos_gl_mappings(lodge_id, mapping_type, source_key, account_id, created_by)
  values (p_lodge_id, p_mapping_type, lower(btrim(p_source_key)), p_account_id, v_actor)
  on conflict (lodge_id, mapping_type, source_key)
  do update set account_id = excluded.account_id, updated_at = now()
  returning id into v_id;

  perform public.log_restaurant_financial_action(
    p_lodge_id, 'pos_gl_mapping_set', 'pos_gl_mapping', v_id, null,
    jsonb_build_object('mapping_type', p_mapping_type, 'source_key', lower(btrim(p_source_key)), 'account_id', p_account_id),
    null
  );
  return jsonb_build_object('success', true, 'data', jsonb_build_object('id', v_id));
end;
$$;

create or replace function public.post_pos_order_to_gl(
  p_lodge_id uuid,
  p_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_order public.pos_orders%rowtype;
  v_category record;
  v_payment jsonb;
  v_account uuid;
  v_lines jsonb := '[]'::jsonb;
  v_category_gross numeric(18,2) := 0;
  v_tender_total numeric(18,2) := 0;
  v_amount numeric(18,2);
  v_gross numeric(18,2);
  v_discount numeric(18,2);
  v_tax numeric(18,2);
  v_tips numeric(18,2);
  v_total numeric(18,2);
  v_is_return boolean;
  v_business_date date;
begin
  v_actor := public._restaurant_require_capability(p_lodge_id, 'accounting.manage');

  select * into v_order
  from public.pos_orders
  where id = p_order_id and lodge_id = p_lodge_id
  for share;
  if not found then
    raise exception 'POS order not found' using errcode = 'P0002';
  end if;
  if v_order.status not in ('completed', 'settled') then
    raise exception 'Only completed or settled POS orders can be posted' using errcode = '22023';
  end if;
  if coalesce(v_order.transaction_type, 'sale') not in ('sale', 'return') then
    raise exception 'Unsupported POS transaction type' using errcode = '22023';
  end if;

  v_is_return := coalesce(v_order.transaction_type, 'sale') = 'return';
  v_gross := abs(round(coalesce(nullif(v_order.gross_total, 0), v_order.total), 2));
  v_discount := abs(round(coalesce(v_order.discount_total, 0), 2));
  v_tax := abs(round(coalesce(v_order.tax_total, 0), 2));
  v_tips := abs(round(coalesce(v_order.tip_total, 0), 2));
  v_total := abs(round(v_order.total, 2));
  v_business_date := coalesce(v_order.business_date, (v_order.completed_at at time zone coalesce(
    (select nullif(btrim(s.timezone), '') from public.settings s where s.lodge_id = p_lodge_id),
    'Africa/Gaborone'
  ))::date);

  if v_total <= 0 or round(v_gross - v_discount + v_tax + v_tips, 2) <> v_total then
    raise exception 'Persisted POS totals do not reconcile' using errcode = '23514';
  end if;

  for v_category in
    select lower(coalesce(nullif(btrim(i.category), ''), 'uncategorized')) as category,
           round(sum(abs(coalesce(nullif(i.gross_subtotal, 0), i.unit_price * i.quantity))), 2) as amount
    from public.pos_order_items i
    where i.order_id = p_order_id and i.lodge_id = p_lodge_id
    group by lower(coalesce(nullif(btrim(i.category), ''), 'uncategorized'))
  loop
    select m.account_id into v_account
    from public.restaurant_pos_gl_mappings m
    join public.restaurant_accounts a on a.id = m.account_id
      and a.lodge_id = p_lodge_id and a.is_active and a.account_type = 'revenue'
    where m.lodge_id = p_lodge_id and m.mapping_type = 'category'
      and m.source_key = v_category.category;
    if v_account is null then
      raise exception 'No active GL revenue mapping for POS category %', v_category.category
        using errcode = '23503';
    end if;
    v_category_gross := v_category_gross + v_category.amount;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_id', v_account,
      'debit', case when v_is_return then v_category.amount else 0 end,
      'credit', case when v_is_return then 0 else v_category.amount end,
      'memo', concat('POS ', v_category.category)
    ));
  end loop;

  if round(v_category_gross, 2) <> v_gross then
    raise exception 'POS item gross does not reconcile to order gross' using errcode = '23514';
  end if;

  if jsonb_typeof(v_order.payment_breakdown) = 'array'
     and jsonb_array_length(v_order.payment_breakdown) > 0 then
    for v_payment in select value from jsonb_array_elements(v_order.payment_breakdown)
    loop
      v_amount := abs(round(coalesce((v_payment->>'amount')::numeric, 0), 2));
      if v_amount <= 0 or nullif(lower(btrim(v_payment->>'method')), '') is null then
        raise exception 'POS payment breakdown contains an invalid tender' using errcode = '22023';
      end if;
      select m.account_id into v_account
      from public.restaurant_pos_gl_mappings m
      join public.restaurant_accounts a on a.id = m.account_id
        and a.lodge_id = p_lodge_id and a.is_active and a.account_type = 'asset'
      where m.lodge_id = p_lodge_id and m.mapping_type = 'tender'
        and m.source_key = lower(btrim(v_payment->>'method'));
      if v_account is null then
        raise exception 'No active GL tender mapping for %', lower(btrim(v_payment->>'method'))
          using errcode = '23503';
      end if;
      v_tender_total := v_tender_total + v_amount;
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'account_id', v_account,
        'debit', case when v_is_return then 0 else v_amount end,
        'credit', case when v_is_return then v_amount else 0 end,
        'memo', concat('POS tender ', lower(btrim(v_payment->>'method')))
      ));
    end loop;
  else
    v_amount := v_total;
    select m.account_id into v_account
    from public.restaurant_pos_gl_mappings m
    join public.restaurant_accounts a on a.id = m.account_id
      and a.lodge_id = p_lodge_id and a.is_active and a.account_type = 'asset'
    where m.lodge_id = p_lodge_id and m.mapping_type = 'tender'
      and m.source_key = lower(btrim(v_order.payment_method));
    if v_account is null then
      raise exception 'No active GL tender mapping for %', lower(btrim(v_order.payment_method))
        using errcode = '23503';
    end if;
    v_tender_total := v_amount;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_id', v_account,
      'debit', case when v_is_return then 0 else v_amount end,
      'credit', case when v_is_return then v_amount else 0 end,
      'memo', concat('POS tender ', lower(btrim(v_order.payment_method)))
    ));
  end if;

  if round(v_tender_total, 2) <> v_total then
    raise exception 'POS tender breakdown does not reconcile to order total' using errcode = '23514';
  end if;

  for v_category in
    select * from (values ('discount', v_discount), ('tax', v_tax), ('tips', v_tips)) x(mapping_type, amount)
    where amount > 0
  loop
    select m.account_id into v_account
    from public.restaurant_pos_gl_mappings m
    join public.restaurant_accounts a on a.id = m.account_id
      and a.lodge_id = p_lodge_id and a.is_active
    where m.lodge_id = p_lodge_id and m.mapping_type = v_category.mapping_type
      and m.source_key = 'default';
    if v_account is null then
      raise exception 'No active default GL mapping for %', v_category.mapping_type
        using errcode = '23503';
    end if;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_id', v_account,
      'debit', case
        when v_category.mapping_type = 'discount' and not v_is_return then v_category.amount
        when v_category.mapping_type <> 'discount' and v_is_return then v_category.amount
        else 0 end,
      'credit', case
        when v_category.mapping_type = 'discount' and v_is_return then v_category.amount
        when v_category.mapping_type <> 'discount' and not v_is_return then v_category.amount
        else 0 end,
      'memo', concat('POS ', v_category.mapping_type)
    ));
  end loop;

  return public._restaurant_post_journal(
    p_lodge_id, v_business_date,
    concat('POS ', coalesce(v_order.transaction_type, 'sale'), ' ', coalesce(v_order.receipt_number, v_order.id::text)),
    concat('pos_', coalesce(v_order.transaction_type, 'sale')),
    v_order.id, v_order.receipt_number,
    concat('pos-order:', v_order.id::text), v_lines, v_actor, null
  );
end;
$$;

revoke all on function public.get_restaurant_pos_gl_mappings(uuid) from public, anon, authenticated;
revoke all on function public.set_restaurant_pos_gl_mapping(uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function public.post_pos_order_to_gl(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_restaurant_pos_gl_mappings(uuid) to service_role;
grant execute on function public.set_restaurant_pos_gl_mapping(uuid, text, text, uuid) to service_role;
grant execute on function public.post_pos_order_to_gl(uuid, uuid) to service_role;

do $$
begin
  if has_table_privilege('anon', 'public.restaurant_pos_gl_mappings', 'SELECT, INSERT, UPDATE, DELETE')
     or has_table_privilege('authenticated', 'public.restaurant_pos_gl_mappings', 'SELECT, INSERT, UPDATE, DELETE')
     or has_function_privilege('anon', 'public.post_pos_order_to_gl(uuid,uuid)'::regprocedure, 'EXECUTE')
     or has_function_privilege('authenticated', 'public.post_pos_order_to_gl(uuid,uuid)'::regprocedure, 'EXECUTE') then
    raise exception 'POS GL rebuild restored operator privileges prematurely';
  end if;
end
$$;

commit;
