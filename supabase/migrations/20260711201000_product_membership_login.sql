-- A person may belong to multiple companies. Desktop sign-in must let the
-- launched product choose a compatible company explicitly rather than taking
-- the first staff row matched by email.
create or replace function public.list_desktop_product_memberships(p_product_id text)
returns table (
  lodge_id uuid,
  lodge_display_name text,
  property_type text,
  role text
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_email text := public.app_authenticated_email();
begin
  if v_email is null then
    return;
  end if;

  if p_product_id not in ('lodge-camp', 'hotel', 'hospitality-pos') then
    raise exception 'Unsupported Boroko product.' using errcode = '22023';
  end if;

  return query
  select
    u.lodge_id,
    coalesce(s.lodge_name, s.company_name, 'Unnamed company') as lodge_display_name,
    coalesce(s.property_type, s.business_type, 'lodge') as property_type,
    lower(btrim(u.role)) as role
  from public.users u
  join public.settings s on s.lodge_id = u.lodge_id
  where lower(btrim(u.email)) = v_email
    and coalesce(u.status, 'active') = 'active'
    and coalesce(s.deleted, false) = false
    and case p_product_id
      when 'lodge-camp' then coalesce(s.property_type, s.business_type, 'lodge') in ('guest_house', 'bnb', 'lodge', 'camp', 'motel')
      when 'hotel' then coalesce(s.property_type, s.business_type, 'lodge') in ('hotel', 'resort')
      when 'hospitality-pos' then coalesce(s.property_type, s.business_type, 'lodge') in ('restaurant', 'pos_only')
      else false
    end
  order by lodge_display_name, u.lodge_id;
end;
$$;

grant execute on function public.list_desktop_product_memberships(text) to authenticated, service_role;
