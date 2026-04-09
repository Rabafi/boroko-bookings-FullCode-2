begin;

alter table public.lodge_features
  alter column lodge_id type uuid
  using nullif(btrim(lodge_id), '')::uuid;

alter table public.support_tickets
  alter column lodge_id type uuid
  using nullif(btrim(lodge_id), '')::uuid;

commit;
