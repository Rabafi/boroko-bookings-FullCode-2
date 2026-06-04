-- Ensure invoice-number generation is exposed as a callable RPC for anon/authenticated clients.
-- The desktop app can fall back when this RPC is missing, but the canonical path should remain
-- an atomic server-side increment to avoid duplicate invoice numbers under concurrent use.

create table if not exists public.invoice_sequences (
  lodge_id uuid not null,
  year int not null,
  last_number int not null default 0,
  primary key (lodge_id, year)
);

revoke all on table public.invoice_sequences from anon, authenticated;

create or replace function public.get_next_invoice_number(p_lodge_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_year int := extract(year from now())::int;
  v_next int;
begin
  insert into public.invoice_sequences (lodge_id, year, last_number)
  values (p_lodge_id, v_year, 1)
  on conflict (lodge_id, year)
  do update
    set last_number = public.invoice_sequences.last_number + 1
  returning last_number into v_next;

  return 'INV-' || v_year || '-' || lpad(v_next::text, 4, '0');
end;
$function$;

grant execute on function public.get_next_invoice_number(uuid) to anon, authenticated, service_role;
