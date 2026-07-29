-- A missing trial anchor creates a perpetual rolling 30-day trial because the
-- entitlement RPC cannot calculate elapsed time. Preserve historical truth by
-- anchoring existing rows to their original creation timestamp, never deploy time.

update public.settings
set trial_started_at = coalesce(created_at, updated_at, now())
where trial_started_at is null;

alter table public.settings
  alter column trial_started_at set default now();

create or replace function public.enforce_settings_trial_anchor()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.trial_started_at := coalesce(new.trial_started_at, new.created_at, now());
  return new;
end;
$$;

drop trigger if exists settings_trial_anchor_guard on public.settings;
create trigger settings_trial_anchor_guard
before insert or update of trial_started_at on public.settings
for each row execute function public.enforce_settings_trial_anchor();
