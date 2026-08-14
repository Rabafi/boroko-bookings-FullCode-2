-- SECURITY DEFINER functions must resolve names through a fixed, trusted
-- search path. This prevents a caller-controlled schema object from shadowing
-- an unqualified table/function used by an elevated RPC. Only functions that
-- are still mutable are changed; functions with an explicit search_path keep
-- their existing, reviewed contract.
do $$
declare
  v_function record;
begin
  for v_function in
    select p.oid::regprocedure::text as signature
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prosecdef = true
       and not exists (
         select 1
           from unnest(coalesce(p.proconfig, array[]::text[])) as cfg(setting)
          where cfg.setting like 'search_path=%'
       )
  loop
    execute format(
      'alter function %s set search_path = public, extensions, pg_temp',
      v_function.signature
    );
  end loop;
end;
$$;
