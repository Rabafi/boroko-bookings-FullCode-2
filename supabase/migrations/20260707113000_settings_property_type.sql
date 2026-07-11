alter table public.settings
  add column if not exists property_type text not null default 'lodge';

update public.settings
set property_type = case
  when lower(coalesce(property_type, business_type, 'lodge')) in (
    'guest_house',
    'guesthouse',
    'bnb',
    'bed_and_breakfast',
    'lodge',
    'camp',
    'motel',
    'hotel',
    'resort',
    'restaurant',
    'pos_only'
  ) then lower(coalesce(property_type, business_type, 'lodge'))
  else 'lodge'
end
where property_type is null
   or btrim(property_type) = '';

update public.settings
set property_type = 'guest_house'
where property_type = 'guesthouse';

update public.settings
set property_type = 'bnb'
where property_type = 'bed_and_breakfast';

update public.settings
set property_type = 'restaurant'
where property_type = 'pos_only';

alter table public.settings
  drop constraint if exists settings_property_type_check;

alter table public.settings
  add constraint settings_property_type_check
  check (property_type in (
    'guest_house',
    'bnb',
    'lodge',
    'camp',
    'motel',
    'hotel',
    'resort',
    'restaurant',
    'apartment_hotel',
    'hostel',
    'serviced_apartments'
  ));
