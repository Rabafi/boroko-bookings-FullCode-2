begin;

create or replace function public.get_lodge_auth_context(
  p_lodge_id uuid
)
returns table (
  contract_version integer,
  lodge_id uuid,
  lodge_display_name text,
  deleted boolean,
  pwa_feature_enabled boolean,
  pwa_plan text
)
language plpgsql
volatile
security definer
set search_path = public
as $function$
begin
  return query
  select
    2 as contract_version,
    p_lodge_id,
    coalesce(s.lodge_name, s.company_name, 'Your Lodge') as lodge_display_name,
    coalesce(s.deleted, false) as deleted,
    coalesce((ent.entitlement->'effective_features'->>'pwa')::boolean, false) as pwa_feature_enabled,
    coalesce(ent.entitlement->>'plan', 'Starter') as pwa_plan
  from (select 1 as anchor) seed
  left join lateral (
    select settings.lodge_name, settings.company_name, settings.deleted
    from public.settings settings
    where settings.lodge_id = p_lodge_id
    order by settings.updated_at desc nulls last, settings.created_at desc nulls last
    limit 1
  ) s on true
  left join lateral (
    select public.get_lodge_entitlement(p_lodge_id) as entitlement
  ) ent on true;
end;
$function$;

revoke all on function public.get_lodge_auth_context(uuid) from public;
grant execute on function public.get_lodge_auth_context(uuid) to anon, authenticated;

notify pgrst, 'reload schema';

commit;
