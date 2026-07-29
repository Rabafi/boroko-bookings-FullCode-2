-- Forward-only public branding migration.
-- Internal product-family keys, session headers, table/RPC names, project ref,
-- and historical financial/audit records intentionally remain unchanged.

create or replace function public.product_family_label(p_product_family text)
returns text
language sql
immutable
set search_path = public
as $$
  select case lower(coalesce(p_product_family, ''))
    when 'lodge-camp' then 'Tsa Bonno LodgingOS'
    when 'hotel' then 'Tsa Bonno HotelOS'
    when 'hospitality-pos' then 'Tsa Bonno Restaurant & Bar POS'
    else 'Tsa Bonno LodgingOS'
  end;
$$;

revoke all on function public.product_family_label(text) from public;
grant execute on function public.product_family_label(text) to anon, authenticated, service_role;

-- Generic future support messages should use the new ecosystem name. Existing
-- rows are operational history and are not rewritten.
alter table if exists public.support_ticket_messages
  alter column sender_name set default 'Tsa Bonno User';

-- Active catalogue copy is mutable presentation metadata. Quote/request
-- snapshots already issued to customers remain immutable.
update public.commercial_package_prices
set
  excluded_features = replace(excluded_features::text, 'Lodge & Camp', 'LodgingOS')::jsonb,
  sales_copy = replace(sales_copy, 'Lodge & Camp', 'LodgingOS')
where excluded_features::text like '%Lodge & Camp%'
   or sales_copy like '%Lodge & Camp%';

-- The quote note is returned by an existing, security-definer calculation
-- function. Preserve its complete validated implementation and replace only
-- the retired public brand phrase.
do $$
declare
  v_definition text;
  v_old_note constant text := 'activation occurs only after Boroko approves payment proof';
  v_new_note constant text := 'activation occurs only after Tsa Bonno approves payment proof';
begin
  select pg_get_functiondef('public.calculate_commercial_quote(jsonb)'::regprocedure)
  into v_definition;

  if position(v_old_note in v_definition) = 0 then
    raise exception 'calculate_commercial_quote brand note was not found; refusing an unverified rewrite';
  end if;

  execute replace(v_definition, v_old_note, v_new_note);
end;
$$;

comment on function public.product_family_label(text) is
  'Customer-facing Tsa Bonno product label for a stable internal product-family key.';
