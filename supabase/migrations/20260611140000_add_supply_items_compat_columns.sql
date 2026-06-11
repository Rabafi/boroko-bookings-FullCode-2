begin;

-- Room supplies list views expect these metadata fields. They do not carry
-- financial truth; stock changes continue to go through the existing RPCs.
alter table public.supply_items
  add column if not exists updated_at timestamptz default now(),
  add column if not exists is_active boolean not null default true;

update public.supply_items
   set updated_at = coalesce(updated_at, created_at, now()),
       is_active = coalesce(is_active, true)
 where updated_at is null
    or is_active is null;

notify pgrst, 'reload schema';

commit;
