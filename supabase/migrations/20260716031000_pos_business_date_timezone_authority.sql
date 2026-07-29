-- A business day belongs to the property's configured timezone, never to a
-- browser, desktop clock, or UTC timestamp boundary.

create or replace function public.pos_business_date_at(
  p_lodge_id uuid,
  p_recorded_at timestamptz
)
returns date
language sql
stable
security definer
set search_path to 'public'
as $$
  select (coalesce(p_recorded_at, now()) at time zone coalesce(
    (select nullif(btrim(s.timezone), '') from public.settings s where s.lodge_id = p_lodge_id limit 1),
    'Africa/Gaborone'
  ))::date;
$$;

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
    public.pos_business_date_at(new.lodge_id, new.created_at)
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

revoke all on function public.pos_business_date_at(uuid, timestamptz) from public;
grant execute on function public.pos_business_date_at(uuid, timestamptz) to authenticated, service_role;
