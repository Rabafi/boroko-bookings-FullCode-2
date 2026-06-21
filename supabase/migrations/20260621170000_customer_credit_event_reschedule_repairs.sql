create table if not exists public.customer_credit_receipt_sequences (
  lodge_id uuid not null,
  year integer not null,
  last_number integer not null default 0,
  primary key (lodge_id, year)
);

alter table public.customer_credit_ledger
  add column if not exists receipt_number text;

create unique index if not exists customer_credit_ledger_receipt_number_uidx
  on public.customer_credit_ledger (lodge_id, receipt_number)
  where receipt_number is not null;

create or replace function public.assign_customer_credit_receipt_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year integer := extract(year from coalesce(new.created_at, now()))::integer;
  v_number integer;
begin
  if new.entry_type <> 'receipt' or new.receipt_number is not null then return new; end if;
  insert into public.customer_credit_receipt_sequences (lodge_id, year, last_number)
  values (new.lodge_id, v_year, 1)
  on conflict (lodge_id, year)
  do update set last_number = public.customer_credit_receipt_sequences.last_number + 1
  returning last_number into v_number;
  new.receipt_number := format('PRE-%s-%s', v_year, lpad(v_number::text, 4, '0'));
  return new;
end;
$$;

drop trigger if exists customer_credit_receipt_number_guard on public.customer_credit_ledger;
create trigger customer_credit_receipt_number_guard
before insert on public.customer_credit_ledger
for each row execute function public.assign_customer_credit_receipt_number();

with numbered as (
  select id, lodge_id, extract(year from created_at)::integer as receipt_year,
         row_number() over (
           partition by lodge_id, extract(year from created_at)::integer
           order by created_at, id
         ) as receipt_sequence
  from public.customer_credit_ledger
  where entry_type = 'receipt' and receipt_number is null
)
update public.customer_credit_ledger ledger
set receipt_number = format('PRE-%s-%s', numbered.receipt_year, lpad(numbered.receipt_sequence::text, 4, '0'))
from numbered
where ledger.id = numbered.id;

insert into public.customer_credit_receipt_sequences (lodge_id, year, last_number)
select lodge_id, extract(year from created_at)::integer, count(*)::integer
from public.customer_credit_ledger
where entry_type = 'receipt'
group by lodge_id, extract(year from created_at)::integer
on conflict (lodge_id, year)
do update set last_number = greatest(public.customer_credit_receipt_sequences.last_number, excluded.last_number);

drop function if exists public.get_customer_credit_history(uuid, uuid, integer, integer);
create function public.get_customer_credit_history(
  p_lodge_id uuid, p_customer_id uuid,
  p_limit integer default 50, p_offset integer default 0
)
returns table(
  id uuid, receipt_number text, entry_type text, amount numeric, method text,
  reference text, notes text, booking_id uuid, payment_id uuid,
  reverses_entry_id uuid, recorded_by uuid, idempotency_key text,
  created_at timestamptz
)
language plpgsql security definer set search_path = public
as $$
begin
  if not public.app_lodge_access(p_lodge_id) then
    raise exception 'Access denied.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.customers c
    where c.id = p_customer_id and c.lodge_id = p_lodge_id
  ) then raise exception 'Customer not found for this lodge.'; end if;
  p_limit := greatest(1, least(coalesce(p_limit, 50), 100));
  p_offset := greatest(0, coalesce(p_offset, 0));
  return query
  select l.id, l.receipt_number, l.entry_type, l.amount, l.method,
         l.reference, l.notes, l.booking_id, l.payment_id,
         l.reverses_entry_id, l.recorded_by, l.idempotency_key, l.created_at
  from public.customer_credit_ledger l
  where l.lodge_id = p_lodge_id and l.customer_id = p_customer_id
  order by l.created_at desc, l.id desc
  limit p_limit offset p_offset;
end;
$$;
revoke all on function public.get_customer_credit_history(uuid, uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.get_customer_credit_history(uuid, uuid, integer, integer)
  to anon, authenticated, service_role;

create or replace function public.customer_credit_child_key(p_key text, p_suffix text)
returns text language sql immutable strict
as $$
  select left(p_key, 90) || '_' || p_suffix || '_' || substr(md5(p_key || ':' || p_suffix), 1, 16)
$$;

do $$
declare v_definition text;
begin
  select pg_get_functiondef(
    'public.reschedule_booking(uuid,uuid,uuid,date,date,text,text,text,boolean,numeric,timestamp with time zone,uuid)'::regprocedure
  ) into v_definition;
  v_definition := replace(v_definition, 'p_idempotency_key || '':transfer''',
    'public.customer_credit_child_key(p_idempotency_key, ''transfer'')');
  v_definition := replace(v_definition, 'p_idempotency_key || '':credit''',
    'public.customer_credit_child_key(p_idempotency_key, ''credit'')');
  execute v_definition;
end;
$$;

do $$
declare v_definition text;
begin
  select pg_get_functiondef('public.create_event_booking(jsonb)'::regprocedure) into v_definition;
  v_definition := replace(
    v_definition,
    E'begin\n  perform public.app_reject_pwa_financial_mutation();',
    E'begin\n  v_event_id := coalesce(v_event_id, nullif(payload->>''id'', '''')::uuid, gen_random_uuid());\n  perform public.app_reject_pwa_financial_mutation();'
  );
  execute v_definition;
end;
$$;

do $$
declare v_definition text;
begin
  select pg_get_functiondef(
    'public.update_booking_status(uuid,uuid,text,timestamp with time zone)'::regprocedure
  ) into v_definition;
  v_definition := replace(
    v_definition,
    'v_booking.check_in > current_date',
    'v_booking.check_in > (now() at time zone ''Africa/Gaborone'')::date'
  );
  execute v_definition;
end;
$$;
