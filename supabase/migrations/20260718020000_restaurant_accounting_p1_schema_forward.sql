begin;

-- Forward migration for existing deployments that ran the original
-- restaurant_accounting_p1 migrations without the account_id/fingerprint columns.

alter table public.restaurant_bank_accounts
  add column if not exists account_id uuid;

DO $$
BEGIN
  if not exists (
    select 1 from pg_constraint where conname = 'restaurant_bank_accounts_account_id_fkey'
  ) then
    alter table public.restaurant_bank_accounts
      add constraint restaurant_bank_accounts_account_id_fkey
      foreign key (account_id) references public.restaurant_accounts(id) on delete restrict;
  end if;
END $$;

alter table public.restaurant_bank_transactions
  add column if not exists fingerprint text;

-- NOTE: Before running this on production, backfill existing bank accounts
-- with their correct GL account_id. Then uncomment:
-- alter table public.restaurant_bank_accounts alter column account_id set not null;

commit;
