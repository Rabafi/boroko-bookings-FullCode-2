begin;

alter table public.customers
  add column if not exists updated_at timestamptz default now();

update public.customers
   set updated_at = coalesce(updated_at, created_at, now())
 where updated_at is null;

notify pgrst, 'reload schema';

commit;
