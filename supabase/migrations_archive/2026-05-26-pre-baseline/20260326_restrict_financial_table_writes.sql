begin;

revoke all privileges on table public.payments from anon, authenticated;

revoke all privileges on table public.invoices from anon, authenticated;
grant select on table public.invoices to anon, authenticated;

commit;
