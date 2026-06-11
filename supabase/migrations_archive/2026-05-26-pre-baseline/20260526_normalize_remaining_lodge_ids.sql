-- Minimal lodge_id normalization (remaining tables only)
-- licenses.lodge_id is already uuid from a previous partial run.
-- This only converts activity_logs and push_subscriptions.

begin;

alter table public.activity_logs
  alter column lodge_id type uuid
  using lodge_id::uuid;

alter table public.push_subscriptions
  alter column lodge_id type uuid
  using lodge_id::uuid;

commit;
