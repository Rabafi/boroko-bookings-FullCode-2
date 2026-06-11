begin;

revoke all privileges on table public.booking_charges from anon, authenticated;
grant select on table public.booking_charges to anon, authenticated;

commit;
