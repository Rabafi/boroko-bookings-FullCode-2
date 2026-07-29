-- Commercial billing read model and one-invoice-per-account-period guard.
-- Finance Office must never fall back to customer booking invoices.

alter table public.commercial_invoices add column if not exists billing_period date;
update public.commercial_invoices
set billing_period = date_trunc('month', coalesce(issued_at, due_date::timestamptz, created_at))::date
where billing_period is null;

with ranked_periods as (
  select
    id,
    row_number() over (
      partition by commercial_account_id, billing_period
      order by coalesce(posted_at, issued_at, created_at) desc, id desc
    ) as row_number
  from public.commercial_invoices
)
update public.commercial_invoices as i
set status = 'void',
    voided_at = coalesce(voided_at, now()),
    void_reason = coalesce(void_reason, 'Superseded duplicate billing period during Command Central integrity repair')
from ranked_periods as duplicate
where duplicate.row_number > 1 and duplicate.id = i.id;

create unique index if not exists commercial_invoice_account_period_unique
  on public.commercial_invoices (commercial_account_id, billing_period)
  where billing_period is not null and status not in ('void', 'written_off');

create or replace function public.set_commercial_invoice_billing_period()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.billing_period is null then
    new.billing_period := date_trunc('month', coalesce(new.issued_at, new.due_date::timestamptz, now()))::date;
  end if;
  return new;
end;
$$;

drop trigger if exists commercial_invoice_billing_period on public.commercial_invoices;
create trigger commercial_invoice_billing_period
before insert or update of issued_at, due_date, billing_period on public.commercial_invoices
for each row execute function public.set_commercial_invoice_billing_period();

create or replace function public.admin_list_commercial_invoices(
  p_lodge_id uuid default null,
  p_product_id text default null,
  p_status text default null,
  p_limit integer default 200,
  p_offset integer default 0
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_rows jsonb;
  v_total integer;
begin
  if not public.app_is_service_role() then raise exception 'Unauthorized' using errcode = '42501'; end if;
  if p_product_id is not null and p_product_id not in ('lodge-camp', 'hotel', 'hospitality-pos') then
    return jsonb_build_object('success', false, 'error', 'Invalid commercial product');
  end if;
  select count(*)::integer into v_total
  from public.commercial_invoices i
  join public.commercial_accounts a on a.id = i.commercial_account_id
  where (p_lodge_id is null or a.lodge_id = p_lodge_id)
    and (p_product_id is null or a.product_id = p_product_id)
    and (p_status is null or i.status = p_status);

  select coalesce(jsonb_agg(to_jsonb(rows) order by rows.issued_at desc nulls last, rows.invoice_number), '[]'::jsonb)
    into v_rows
  from (
    select
      i.id,
      i.invoice_number,
      a.lodge_id,
      coalesce(s.lodge_name, s.company_name, a.lodge_id::text) as lodge_name,
      a.product_id,
      i.status,
      i.currency,
      i.billing_period,
      i.issued_at,
      i.issued_at::date as issued_date,
      i.due_date,
      i.total,
      i.total as amount,
      i.balance_due,
      i.pricing_snapshot->>'commercial_package_key' as package_name,
      coalesce(i.pricing_snapshot->>'commercial_package_key', 'Commercial subscription') as description,
      i.created_at,
      i.posted_at,
      i.voided_at
    from public.commercial_invoices i
    join public.commercial_accounts a on a.id = i.commercial_account_id
    left join public.settings s on s.lodge_id = a.lodge_id
    where (p_lodge_id is null or a.lodge_id = p_lodge_id)
      and (p_product_id is null or a.product_id = p_product_id)
      and (p_status is null or i.status = p_status)
    order by i.issued_at desc nulls last, i.invoice_number
    limit greatest(least(coalesce(p_limit, 200), 1000), 1)
    offset greatest(coalesce(p_offset, 0), 0)
  ) rows;
  return jsonb_build_object('success', true, 'source', 'commercial_ledger', 'rows', v_rows, 'total', v_total);
end;
$$;

create or replace function public.admin_get_commercial_billing_summary()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_currency text;
  v_total numeric;
  v_outstanding numeric;
  v_paid_count integer;
  v_pending_count integer;
  v_by_month jsonb;
begin
  if not public.app_is_service_role() then raise exception 'Unauthorized' using errcode = '42501'; end if;
  select case when count(distinct currency) = 1 then min(currency) else 'MIXED' end,
         coalesce(sum(case when status = 'paid' then total else 0 end), 0),
         coalesce(sum(balance_due), 0),
         count(*) filter (where status = 'paid'),
         count(*) filter (where status in ('posted', 'draft'))
    into v_currency, v_total, v_outstanding, v_paid_count, v_pending_count
  from public.commercial_invoices;
  select coalesce(jsonb_agg(jsonb_build_object('month', month, 'amount', amount) order by month desc), '[]'::jsonb)
    into v_by_month
  from (
    select to_char(date_trunc('month', coalesce(issued_at, created_at)), 'YYYY-MM') as month,
           coalesce(sum(case when status = 'paid' then total else 0 end), 0) as amount
    from public.commercial_invoices
    group by 1
  ) months;
  return jsonb_build_object(
    'success', true,
    'source', 'commercial_ledger',
    'currency', v_currency,
    'total', v_total,
    'outstanding', v_outstanding,
    'paid_count', v_paid_count,
    'pending_count', v_pending_count,
    'byMonth', v_by_month
  );
end;
$$;

revoke all on function public.set_commercial_invoice_billing_period() from public, anon, authenticated;
revoke all on function public.admin_list_commercial_invoices(uuid, text, text, integer, integer), public.admin_get_commercial_billing_summary() from public, anon, authenticated;
grant execute on function public.admin_list_commercial_invoices(uuid, text, text, integer, integer), public.admin_get_commercial_billing_summary() to service_role;
notify pgrst, 'reload schema';
