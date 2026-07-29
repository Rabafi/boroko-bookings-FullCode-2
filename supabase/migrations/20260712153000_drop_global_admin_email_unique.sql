-- Multi-product / multi-company staff model allows the same admin email to
-- exist at different companies (e.g. restaurant POS + hotel).
-- Per-lodge uniqueness remains via users_email_lodge_unique / users_lodge_id_email_key.
--
-- The partial unique index users_admin_email_unique blocked second-company
-- setup with: duplicate key value violates unique constraint "users_admin_email_unique".

drop index if exists public.users_admin_email_unique;

-- Keep a non-unique helper for admin email lookups if needed by tooling.
create index if not exists users_admin_email_lookup_idx
  on public.users using btree (lower(btrim(email)))
  where role = any (array['admin'::text, 'super_admin'::text]);

comment on index public.users_admin_email_lookup_idx is
  'Non-unique lookup for admin emails across companies. Global uniqueness was intentionally removed for multi-company membership.';
