-- Quotation currency is lodge configuration, not free-form financial input.
-- This prevents amount text from being stored as a currency label and then
-- rendered beside the real amount (for example "BWP 6 000.00 6,000.00").

create or replace function public.guard_quotation_currency()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_currency text;
begin
  select nullif(btrim(coalesce(s.currency, '')), '')
    into v_currency
  from public.settings s
  where s.lodge_id = new.lodge_id
    and coalesce(s.deleted, false) = false
  order by s.updated_at desc nulls last, s.created_at desc nulls last
  limit 1;

  if v_currency is null then
    v_currency := nullif(btrim(coalesce(new.currency, '')), '');
  end if;

  -- Currency labels may be short codes or symbols, never amount-bearing text.
  if v_currency is null
     or length(v_currency) > 8
     or v_currency ~ '[0-9]' then
    v_currency := 'BWP';
  end if;

  new.currency := v_currency;
  return new;
end;
$$;

drop trigger if exists trg_guard_quotation_currency on public.quotations;
create trigger trg_guard_quotation_currency
before insert or update of lodge_id, currency
on public.quotations
for each row
execute function public.guard_quotation_currency();

-- Repair existing contaminated labels from each quotation's lodge settings.
update public.quotations q
set currency = coalesce(
  (
    select nullif(btrim(coalesce(s.currency, '')), '')
    from public.settings s
    where s.lodge_id = q.lodge_id
      and coalesce(s.deleted, false) = false
    order by s.updated_at desc nulls last, s.created_at desc nulls last
    limit 1
  ),
  'BWP'
)
where q.currency is null
   or btrim(q.currency) = ''
   or length(btrim(q.currency)) > 8
   or q.currency ~ '[0-9]';

