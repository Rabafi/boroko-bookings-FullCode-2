-- Final linked-lint repairs after the 20260814020000 schema-drift pass.

begin;

-- extensions.index_advisor calls HypoPG functions without qualification, but
-- the extension is intentionally installed in the protected extensions
-- schema. Public wrappers keep the advisor executable without changing the
-- owner or search_path of Supabase's managed function.
create or replace function public.hypopg_reset()
returns void
language sql
security definer
set search_path = extensions, public
as $$ select extensions.hypopg_reset(); $$;

create or replace function public.hypopg_get_indexdef(p_indexrelid oid)
returns text
language sql
security definer
set search_path = extensions, public
as $$ select extensions.hypopg_get_indexdef(p_indexrelid); $$;

grant execute on function public.hypopg_reset(), public.hypopg_get_indexdef(oid)
  to public;

-- Qualify the PL/pgSQL operation_id variable in the voucher ledger insert.
do $do$
declare
  v_definition text;
  v_old text;
  v_new text;
  v_occurrences integer;
begin
  select pg_get_functiondef('public._restaurant_post_pos_order_to_gl_v2(uuid,uuid)'::regprocedure)
    into v_definition;

  v_old := 'AS $function$' || chr(10) || 'declare';
  v_new := 'AS $function$' || chr(10) || '<<financial_post>>' || chr(10) || 'declare';
  v_occurrences := (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old);
  if v_occurrences <> 1 then
    raise exception '_restaurant_post_pos_order_to_gl_v2 block-label contract is ambiguous or missing';
  end if;
  v_definition := replace(v_definition, v_old, v_new);

  v_old := $old$values(p_lodge,voucher,p_order_id,operation_id,case when is_return then tender_amount else -tender_amount end,case when is_return then remaining+tender_amount else remaining-tender_amount end,case when is_return then 'return' else 'redeem' end,actor)$old$;
  v_new := $new$values(p_lodge,voucher,p_order_id,financial_post.operation_id,case when is_return then tender_amount else -tender_amount end,case when is_return then remaining+tender_amount else remaining-tender_amount end,case when is_return then 'return' else 'redeem' end,actor)$new$;
  v_occurrences := (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old);
  if v_occurrences <> 1 then
    raise exception '_restaurant_post_pos_order_to_gl_v2 operation_id contract is ambiguous or missing';
  end if;

  execute replace(v_definition, v_old, v_new);
end
$do$;

commit;
