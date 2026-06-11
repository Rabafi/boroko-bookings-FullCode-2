begin;

revoke all privileges on table public.master_admins from anon, authenticated;
revoke all privileges on table public.licenses from anon, authenticated;
revoke all privileges on table public.broadcasts from anon, authenticated;
revoke all privileges on table public.activity_logs from anon, authenticated;
grant select on table public.broadcasts to anon, authenticated;

revoke all privileges on table public.lodge_features from anon, authenticated;
grant select on table public.lodge_features to anon, authenticated;

revoke all privileges on table public.support_tickets from anon, authenticated;
grant insert on table public.support_tickets to anon, authenticated;

commit;
