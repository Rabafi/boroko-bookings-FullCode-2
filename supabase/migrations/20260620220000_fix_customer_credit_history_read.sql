-- Repair the customer-credit history read RPC.
-- PL/pgSQL output columns (including "id") are variables inside the function,
-- so every table column must be qualified to avoid ambiguous references.

create or replace function public.get_customer_credit_history(
  p_lodge_id uuid,
  p_customer_id uuid,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table(
  id uuid,
  entry_type text,
  amount numeric,
  method text,
  reference text,
  notes text,
  booking_id uuid,
  payment_id uuid,
  reverses_entry_id uuid,
  recorded_by uuid,
  idempotency_key text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.app_lodge_access(p_lodge_id) then
    raise exception 'Access denied.' using errcode = '42501';
  end if;

  if not exists (
    select 1
      from public.customers c
     where c.id = p_customer_id
       and c.lodge_id = p_lodge_id
  ) then
    raise exception 'Customer not found for this lodge.';
  end if;

  p_limit := greatest(1, least(coalesce(p_limit, 50), 100));
  p_offset := greatest(0, coalesce(p_offset, 0));

  return query
  select
    l.id,
    l.entry_type,
    l.amount,
    l.method,
    l.reference,
    l.notes,
    l.booking_id,
    l.payment_id,
    l.reverses_entry_id,
    l.recorded_by,
    l.idempotency_key,
    l.created_at
  from public.customer_credit_ledger l
  where l.lodge_id = p_lodge_id
    and l.customer_id = p_customer_id
  order by l.created_at desc, l.id desc
  limit p_limit offset p_offset;
end;
$$;

revoke all on function public.get_customer_credit_history(uuid, uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.get_customer_credit_history(uuid, uuid, integer, integer)
  to anon, authenticated, service_role;
