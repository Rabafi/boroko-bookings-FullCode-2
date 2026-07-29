begin;

-- Compatibility bridge for the canonical session actor helper used by the
-- Restaurant Accounting P0/P1 contracts. This is intentionally not callable
-- by client roles; accounting SECURITY DEFINER functions invoke it as owner.
create or replace function public.app_get_actor_user_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select public.app_current_user_id();
$$;

revoke all on function public.app_get_actor_user_id() from public, anon, authenticated;

commit;