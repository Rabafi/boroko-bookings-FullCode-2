-- HypoPG compatibility wrappers are for the managed advisor only; they are
-- not an application or anonymous API surface.

begin;

revoke all on function public.hypopg_reset(), public.hypopg_get_indexdef(oid)
  from public, anon, authenticated;
grant execute on function public.hypopg_reset(), public.hypopg_get_indexdef(oid)
  to postgres, service_role;

commit;
