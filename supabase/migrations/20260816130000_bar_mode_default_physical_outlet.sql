-- A Bar-mode company needs one durable beverage outlet. The legacy client can
-- render a virtual Bar when no rows exist, but virtual choices have no UUID and
-- cannot safely own stock, menu items, packs, orders or cash-up evidence.

begin;

create or replace function public.ensure_bar_mode_default_outlet(p_lodge_id uuid)
returns void
language plpgsql
security definer
set search_path to public
as $$
declare
  v_is_bar_mode boolean;
  v_sort_order integer;
begin
  if p_lodge_id is null then
    return;
  end if;

  select
    s.property_type = 'restaurant'
    and coalesce(s.operating_profile->>'hospitality_mode', '') = 'bar_only'
    into v_is_bar_mode
  from public.settings s
  where s.lodge_id = p_lodge_id;

  if not coalesce(v_is_bar_mode, false) then
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('bar-default-outlet:' || p_lodge_id::text, 0));

  if exists (
    select 1
    from public.outlets o
    where o.lodge_id = p_lodge_id
      and o.type = 'beverage'
      and o.is_active = true
  ) then
    return;
  end if;

  select coalesce(max(o.sort_order), 0) + 1
    into v_sort_order
  from public.outlets o
  where o.lodge_id = p_lodge_id;

  insert into public.outlets (lodge_id, name, type, is_active, sort_order)
  values (p_lodge_id, 'Bar', 'beverage', true, v_sort_order);
end;
$$;

revoke all on function public.ensure_bar_mode_default_outlet(uuid) from public, anon, authenticated;

create or replace function public.provision_bar_mode_default_outlet_trigger()
returns trigger
language plpgsql
security definer
set search_path to public
as $$
begin
  perform public.ensure_bar_mode_default_outlet(new.lodge_id);
  return new;
end;
$$;

revoke all on function public.provision_bar_mode_default_outlet_trigger() from public, anon, authenticated;

drop trigger if exists settings_provision_bar_mode_default_outlet on public.settings;
create trigger settings_provision_bar_mode_default_outlet
after insert or update of property_type, operating_profile on public.settings
for each row execute function public.provision_bar_mode_default_outlet_trigger();

-- Backfill every existing Bar-mode company once. Existing physical beverage
-- outlets are left untouched, as are historical unassigned stock records.
select public.ensure_bar_mode_default_outlet(s.lodge_id)
from public.settings s
where s.property_type = 'restaurant'
  and coalesce(s.operating_profile->>'hospitality_mode', '') = 'bar_only';

commit;
