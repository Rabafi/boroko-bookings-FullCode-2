-- Operator-facing Till identifiers reset for each business day.  The UUID
-- remains the immutable technical identifier; the business date plus sequence
-- is the unique financial reference, so a simple #0001 is never ambiguous.

alter table public.pos_orders
  add column if not exists business_date date,
  add column if not exists daily_order_number integer,
  add column if not exists order_number text;

create table if not exists public.pos_daily_order_sequences (
  -- The shared schema does not have a canonical lodges table.  Lodge scope is
  -- enforced by the POS write RPC and the composite primary key below.
  lodge_id uuid not null,
  business_date date not null,
  last_number integer not null default 0 check (last_number >= 0),
  primary key (lodge_id, business_date)
);

-- Botswana is the operating timezone for this product.  Store the resolved
-- business date on every order so later reporting does not re-interpret a UTC
-- timestamp and lose early-morning sales.
create or replace function public.assign_pos_daily_order_number()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_business_date date;
  v_daily_number integer;
begin
  v_business_date := coalesce(
    new.business_date,
    (coalesce(new.created_at, now()) at time zone 'Africa/Gaborone')::date
  );
  new.business_date := v_business_date;

  if new.daily_order_number is null then
    insert into public.pos_daily_order_sequences (lodge_id, business_date, last_number)
    values (new.lodge_id, v_business_date, 1)
    on conflict (lodge_id, business_date)
    do update set last_number = public.pos_daily_order_sequences.last_number + 1
    returning last_number into v_daily_number;

    new.daily_order_number := v_daily_number;
  end if;

  new.order_number := coalesce(new.order_number, lpad(new.daily_order_number::text, 4, '0'));
  new.receipt_number := coalesce(
    new.receipt_number,
    case when coalesce(new.transaction_type, 'sale') = 'return' then 'RET-' else 'R-' end
      || lpad(new.daily_order_number::text, 4, '0')
  );
  return new;
end;
$$;

drop trigger if exists trg_assign_pos_daily_order_number on public.pos_orders;
create trigger trg_assign_pos_daily_order_number
before insert on public.pos_orders
for each row execute function public.assign_pos_daily_order_number();

-- Give the existing ledger the same concise identifiers, ordered by when the
-- transaction actually happened.  Receipt identity is unique as
-- lodge + business_date + daily_order_number, not globally across years.
with ordered as (
  select
    id,
    lodge_id,
    (created_at at time zone 'Africa/Gaborone')::date as resolved_business_date,
    row_number() over (
      partition by lodge_id, (created_at at time zone 'Africa/Gaborone')::date
      order by created_at, id
    )::integer as resolved_daily_order_number
  from public.pos_orders
  where daily_order_number is null
)
update public.pos_orders o
set business_date = ordered.resolved_business_date,
    daily_order_number = ordered.resolved_daily_order_number,
    order_number = lpad(ordered.resolved_daily_order_number::text, 4, '0'),
    receipt_number = coalesce(
      o.receipt_number,
      case when coalesce(o.transaction_type, 'sale') = 'return' then 'RET-' else 'R-' end
        || lpad(ordered.resolved_daily_order_number::text, 4, '0')
    )
from ordered
where o.id = ordered.id;

insert into public.pos_daily_order_sequences (lodge_id, business_date, last_number)
select lodge_id, business_date, max(daily_order_number)
from public.pos_orders
where business_date is not null and daily_order_number is not null
group by lodge_id, business_date
on conflict (lodge_id, business_date)
do update set last_number = greatest(
  public.pos_daily_order_sequences.last_number,
  excluded.last_number
);

create unique index if not exists pos_orders_lodge_business_day_number_uidx
  on public.pos_orders (lodge_id, business_date, daily_order_number)
  where business_date is not null and daily_order_number is not null;

create index if not exists pos_orders_lodge_business_date_idx
  on public.pos_orders (lodge_id, business_date desc, daily_order_number desc);

revoke all on function public.assign_pos_daily_order_number() from public;
grant execute on function public.assign_pos_daily_order_number() to service_role;
