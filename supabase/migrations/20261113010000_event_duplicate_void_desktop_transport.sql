-- Desktop uses the anon transport role with a separately validated app session.
-- Operator approved this one RPC's transport grant on 13 November 2026.
-- The SECURITY DEFINER function still enforces actor, lodge and finance role.
begin;

do $$
declare
  v_definition text;
begin
  select pg_get_functiondef('public.void_duplicate_event_payment(uuid,uuid,uuid,uuid,numeric,text,text)'::regprocedure)
    into v_definition;
  if position('public.app_current_user_id()' in v_definition) = 0
     or position('public.app_require_lodge_role(p_lodge_id' in v_definition) = 0
     or position('public.app_reject_pwa_financial_mutation()' in v_definition) = 0
     or position('SECURITY DEFINER' in v_definition) = 0 then
    raise exception 'Duplicate payment correction authorization contract changed; refusing transport grant';
  end if;
end;
$$;

grant execute on function public.void_duplicate_event_payment(uuid,uuid,uuid,uuid,numeric,text,text) to anon;

commit;
