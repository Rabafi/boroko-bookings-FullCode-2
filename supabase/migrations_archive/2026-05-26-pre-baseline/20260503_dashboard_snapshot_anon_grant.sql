begin;

revoke all on function public.get_manager_dashboard_snapshot(uuid, date) from public;
grant execute on function public.get_manager_dashboard_snapshot(uuid, date) to anon, authenticated, service_role;

notify pgrst, 'reload schema';

commit;
